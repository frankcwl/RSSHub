import { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { config } from '@/config';
import { load } from 'cheerio';
import cache from '@/utils/cache';

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

async function handler() {
    const baseUrl = 'https://hanime1.me';
    const username = config.hanime1.username;
    const password = config.hanime1.password;

    if (!username || !password) {
        throw new Error('Missing username and password.');
    }

    const cookies = await cache.tryGet(
        'hanime1:token',
        async () => {
            let response = await ofetch.raw(baseUrl + '/login', {
                retryStatusCodes: [400, 403, 408, 409, 419, 425, 429, 500, 502, 503, 504],
                headers: {
                    referer: baseUrl,
                    'user-agent': config.trueUA,
                },
            });
            const $ = load(response._data);
            const csrf_token = $('meta[name="csrf-token"]').attr('content');

            response = await ofetch.raw(baseUrl + '/login', {
                retryStatusCodes: [400, 403, 408, 409, 419, 425, 429, 500, 502, 503, 504],
                method: 'POST',
                redirect: 'manual',
                headers: {
                    referer: baseUrl,
                    'user-agent': config.trueUA,
                    'content-type': 'application/x-www-form-urlencoded',
                    cookie: response.headers.getSetCookie().join('; '),
                },
                body: `_token=${csrf_token}&email=${encodeURIComponent(username)}&password=${password}`,
            });

            return response.headers.getSetCookie().join('; ');
        },
        30 * 24 * 60 * 60,
        false
    );

    const finalResponse = await ofetch(baseUrl + '/subscriptions', {
        retryStatusCodes: [400, 403, 408, 409, 425, 419, 429, 500, 502, 503, 504],
        headers: {
            referer: baseUrl,
            'user-agent': config.trueUA,
            cookie: cookies,
        },
    });
    const $ = load(finalResponse);

    const target = '.content-padding-new .row.no-gutter';

    const items = $(target)
        .find('.search-doujin-videos.hidden-xs') // 过滤掉重复的元素
        .toArray()
        .slice(0, 30)
        .map((item) => {
            const element = $(item);
            const title = element.find('.card-mobile-title').text();
            const author = element.find('.card-mobile-user').text();
            const link = element.find('a.overlay').attr('href');
            const imageSrc = element.find('img[style*="object-fit: cover"]').attr('src'); // 选择缩略图

            return {
                title,
                link,
                author,
                description: `<img src="${imageSrc}">`,
            };
        });

    const detailedItems = await Promise.all(
        items.map((item) =>
            cache.tryGet(<string>item.link, async () => {
                const pageResponse = await ofetch(<string>item.link, {
                    retryStatusCodes: [400, 403, 408, 409, 419, 425, 429, 500, 502, 503, 504],
                    headers: {
                        referer: baseUrl,
                        'user-agent': config.trueUA,
                    },
                });
                const $ = load(pageResponse);
                const video = $.root().find('video');
                const largeImageSrc = video.attr('poster');
                const source = video.find('source[size="1080"]');
                const videoLink = source.attr('src');
                const contentType = source.attr('type');
                const videoDescription = $.root().find('div.video-caption-text').text();
                if (videoLink) {
                    const videoResponse = await ofetch.raw(videoLink, {
                        method: 'HEAD',
                        retryStatusCodes: [400, 403, 408, 409, 419, 425, 429, 500, 502, 503, 504],
                        headers: {
                            referer: baseUrl,
                            'user-agent': config.trueUA,
                        },
                    });
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
            })
        )
    );

    return {
        title: 'Hanime1 订阅内容',
        link: 'https://hanime1.me/subscriptions',
        item: detailedItems,
    };
}
