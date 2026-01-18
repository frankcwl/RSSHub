import { load } from 'cheerio';
import { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { config } from '@/config';
import got from '@/utils/got';
import logger from '@/utils/logger';
import cache from '@/utils/cache';
import ConfigNotFoundError from '@/errors/types/config-not-found';

const BASE_URL = 'https://hanime1.me';
const CACHE_TTL = 30 * 24 * 60 * 60; // 30天

// 类型定义
interface VideoItem {
    title: string;
    link: string | undefined;
    author: string;
    description: string;
}

interface DetailedVideoItem extends VideoItem {
    enclosure_url?: string;
    enclosure_length?: number;
    enclosure_type?: string;
}

export const route: Route = {
    path: '/subscriptions',
    name: '订阅内容',
    maintainers: ['frankcwl'],
    example: '/hanime1/subscriptions',
    categories: ['anime'],
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler,
};

// FlareSolverr请求辅助函数
function flareSolverrRequest(cmd: string, params: Record<string, any> = {}) {
    return got.post({
        url: config.flaresolverrUrl,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd, ...params }),
    });
}

async function handler() {
    const username = config.hanime1.username;
    const password = config.hanime1.password;

    if (!username || !password) {
        throw new ConfigNotFoundError('Missing Hanime1 username and password.');
    }

    const sessionId = await cache.tryGet(
        'hanime1:sessionId',
        async () => {
            // 首先检查是否有现有的会话
            const listResponse = await flareSolverrRequest('sessions.list');

            // 如果有活跃会话，使用第一个会话的sessionId
            if (listResponse.data.sessions && listResponse.data.sessions.length > 0) {
                logger.debug('Use existing FlareSolverr session');
                return listResponse.data.sessions[0];
            }

            // 如果没有现有会话，创建新会话
            const sessionResponse = await flareSolverrRequest('sessions.create');

            // 获取session的值
            const newSessionId = sessionResponse.data.session;

            // 使用sessionId获取登录页面
            const loginPageResponse = await flareSolverrRequest('request.get', {
                session: newSessionId,
                url: BASE_URL + '/login',
            });

            const $ = load(loginPageResponse.data.solution.response);
            const csrf_token = $('meta[name="csrf-token"]').attr('content');

            // 通过FlareSolverr发送登录请求
            await flareSolverrRequest('request.post', {
                session: newSessionId,
                url: BASE_URL + '/login',
                postData: `_token=${csrf_token}&email=${encodeURIComponent(username)}&password=${password}`,
            });

            // 返回sessionId，保留会话
            return newSessionId;
        },
        CACHE_TTL,
        false
    );

    // 使用sessionId通过FlareSolverr获取订阅页面
    const subscriptionsResponse = await flareSolverrRequest('request.get', {
        session: sessionId,
        url: BASE_URL + '/subscriptions',
    });

    const $ = load(subscriptionsResponse.data.solution.response);

    const items = $('.video-item-container')
        .toArray()
        .slice(0, 5)
        .map((item) => {
            const element = $(item);
            const title = element.find('.title').text().trim();
            const subtitle = element.find('.subtitle a').text().trim();
            // 从subtitle中提取作者名（假设格式为"作者名 • 时间"）
            const author = subtitle.split('•')[0]?.trim() || '';
            let link = element.find('.video-link').attr('href');
            const imageSrc = element.find('.main-thumb').attr('src');

            // 确保链接是完整的URL
            if (link && !link.startsWith('http')) {
                link = BASE_URL + link;
            }

            return {
                title,
                link,
                author,
                description: `<img src="${imageSrc}">`,
            };
        });

    const detailedItems: DetailedVideoItem[] = [];
    for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        const detailedItem = await cache.tryGet(<string>item.link, async () => {
            // 使用FlareSolverr获取视频详情页面
            const pageResponse = await flareSolverrRequest('request.get', {
                session: sessionId,
                url: item.link,
            });

            const $ = load(pageResponse.data.solution.response);
            const video = $.root().find('video');
            const largeImageSrc = video.attr('poster');
            const source = video.find('source[size="1080"]');
            const videoLink = source.attr('src');
            const contentType = source.attr('type');
            const videoDescription = $.root().find('div.video-caption-text').text();

            if (videoLink) {
                const videoResponse = await ofetch.raw(videoLink, { method: 'HEAD' });
                const contentLength = Number.parseInt(<string>videoResponse.headers.get('content-length'));
                return {
                    title: item.title,
                    link: item.link,
                    author: item.author,
                    description: `<img src="${largeImageSrc}">` + videoDescription,
                    enclosure_url: videoLink,
                    enclosure_length: contentLength,
                    enclosure_type: contentType,
                };
            } else {
                return {
                    title: item.title,
                    link: item.link,
                    author: item.author,
                    description: item.description,
                };
            }
        });
        detailedItems.push(detailedItem);
    }

    return {
        title: 'Hanime1 订阅内容',
        link: BASE_URL + '/subscriptions',
        item: detailedItems,
    };
}
