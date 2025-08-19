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

    const cookies = await cache.tryGet(
        'hanime1:token',
        async () => {
            let response = await ofetch.raw(baseUrl + '/login', {
                retryStatusCodes: [400, 403, 408, 409, 425, 429, 500, 502, 503, 504],
                headers: {
                    referer: baseUrl,
                    'user-agent': config.trueUA,
                },
            });
            const $ = load(response._data);
            const csrf_token = $('meta[name="csrf-token"]').attr('content');

            response = await ofetch.raw(baseUrl + '/login', {
                retryStatusCodes: [400, 403, 408, 409, 425, 429, 500, 502, 503, 504],
                method: 'POST',
                redirect: 'manual',
                headers: {
                    referer: baseUrl,
                    'user-agent': config.trueUA,
                    'content-type': 'application/x-www-form-urlencoded',
                    cookie: response.headers.getSetCookie().join('; '),
                },
                body: `_token=${csrf_token}&email=frankcwl%40126.com&password=PengPeng314`,
            });

            return response.headers.getSetCookie().join('; ');
        },
        30 * 24 * 60 * 60,
        false
    );

    const finalResponse = await ofetch(baseUrl + '/subscriptions', {
        retryStatusCodes: [400, 403, 408, 409, 425, 429, 500, 502, 503, 504],
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
        .map((item) => {
            const element = $(item);
            const title = element.find('.card-mobile-title').text();
            const author = element.find('.card-mobile-user').text();
            const videoLink = element.find('a.overlay').attr('href');
            const imageSrc = element.find('img[style*="object-fit: cover"]').attr('src'); // 选择缩略图

            return {
                title,
                link: videoLink,
                author,
                description: `<img src="${imageSrc}">`,
            };
        });

    return {
        title: 'Hanime1 订阅内容',
        link: 'https://hanime1.me/subscriptions',
        item: items.slice(0, 30),
    };
}
