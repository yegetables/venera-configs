class Wnacg extends ComicSource {
    // Note: The fields which are marked as [Optional] should be removed if not used

    // name of the source
    name = "紳士漫畫"

    // unique id of the source
    key = "wnacg"

    version = "1.1.1"

    minAppVersion = "1.0.0"

    // update url
    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/wnacg.js"

    static domains = [];

    get baseUrl() {
        let selection = this.loadSetting('domainSelection')
        if (selection === undefined || selection === null) selection = 0
        selection = parseInt(selection)

        if (selection === 0) {
            // 选择自定义域名
            let domain0 = this.loadSetting('domain0')
            if (!domain0 || domain0.trim() === '') {
                throw 'Custom domain is not set'
            }
            return `https://${domain0.trim()}`
        } else {
            // 选择获取的域名 (Domain 1-3)
            let index = selection - 1
            if (index >= Wnacg.domains.length) {
                throw 'Selected domain is unavailable'
            }
            return `https://${Wnacg.domains[index]}`
        }
    }

    overwriteDomains(domains) {
        if (domains.length != 0) Wnacg.domains = domains
    }

    // [Optional] account related
    account = {
        /**
         * login, return any value to indicate success
         * @param account {string}
         * @param pwd {string}
         * @returns {Promise<any>}
         */
        login: async (account, pwd) => {
            let res = await Network.post(
                `${this.baseUrl}/users-check_login.html`,
                {
                    'content-type': 'application/x-www-form-urlencoded'
                },
                `login_name=${encodeURIComponent(account)}&login_pass=${encodeURIComponent(pwd)}`
            )
            if (res.status !== 200) {
                throw 'Login failed'
            }
            let json = JSON.parse(res.body)
            if (json['html'].includes('登錄成功')) {
                return 'ok'
            }
            throw 'Login failed'
        },

        /**
         * logout function, clear account related data
         */
        logout: () => {
            Network.deleteCookies(this.baseUrl)
        },

        // {string?} - register url
        registerWebsite: null
    }

    async init() {
        if (this.loadSetting('refreshDomainsOnStart')) await this.refreshDomains(false)
    }

    /**
     * 刷新域名列表
     * @param showConfirmDialog {boolean}
     */
    async refreshDomains(showConfirmDialog) {
        // 发布页本身也会换域名；旧的 wn01.link 已失效，按顺序尝试
        const publishPages = [
            "https://wnacg01.link/",
            "https://wnacg02.link/",
        ]
        let title = ""
        let message = ""
        let domains = []
        let seenDomains = new Set()

        for (let url of publishPages) {
            try {
                let res = await fetch(url)
                if (res.status != 200) continue
                let html = await res.text()
                let document = new HtmlDocument(html)
                // 提取所有链接
                let links = document.querySelectorAll("a[href]")

                for (let link of links) {
                    let href = link.attributes["href"]
                    if (!href) continue

                    // 提取域名（支持 http:// 和 https://）
                    let match = href.match(/^https?:\/\/([^\/]+)/)
                    if (match) {
                        let domain = match[1]
                        // 排除无关链接与发布页自身(wnacg01.link 等)
                        if (domain &&
                            domain.includes(".") &&
                            !domain.includes("google.cn") &&
                            !domain.includes("cdn-cgi") &&
                            !/^(wn|wnacg)\d*\.link$/i.test(domain) &&
                            !seenDomains.has(domain)) {
                            domains.push(domain)
                            seenDomains.add(domain)
                        }
                    }
                }
                document.dispose()

                // 抓到就不再试下一个发布页
                if (domains.length > 0) break
            } catch (e) {
                // 换下一个发布页
            }
        }

        if (domains.length == 0) {
            title = "Update Failed"
            message = "Using Custom: \n\n"
            domains = Wnacg.domains
        } else {
            title = "Update Success"
            message = "Fetched: \n\n"
        }

        for (let i = 0; i < domains.length; i++) {
            message = message + `URL ${i + 1}: ${domains[i]}\n`
        }
        message = message + `\n Total: ${domains.length} URLs\n\n Re-enter page to refresh`

        if (showConfirmDialog) {
            UI.showDialog(
                title,
                message,
                [
                    {
                        text: "Cancel",
                        callback: () => { }
                    },
                    {
                        text: "Apply",
                        callback: () => this.overwriteDomains(domains)
                    }
                ]
            )
        } else {
            this.overwriteDomains(domains)
        }
    }

    parseComic(c) {
        let link = c.querySelector("div.pic_box > a").attributes["href"];
        let id = RegExp("(?<=-aid-)[0-9]+").exec(link)[0];
        let image =
            c.querySelector("div.pic_box > a > img").attributes["src"];
        image = `https:${image}`;
        let name = c.querySelector("div.info > div.title > a").text;
        let info = c.querySelector("div.info > div.info_col").text.trim();
        info = info.replaceAll('\n', '');
        info = info.replaceAll('\t', '');
        return new Comic({
            id: id,
            title: name,
            cover: image,
            description: info,
        })
    }

    // explore page list
    explore = [
        {
            // title of the page.
            // title is used to identify the page, it should be unique
            title: "紳士漫畫",

            /// multiPartPage or multiPageComicList or mixed
            type: "multiPartPage",

            /**
             * load function
             * @param page {number | null} - page number, null for `singlePageWithMultiPart` type
             * @returns {{}}
             * - for `multiPartPage` type, return [{title: string, comics: Comic[], viewMore: string?}]
             * - for `multiPageComicList` type, for each page(1-based), return {comics: Comic[], maxPage: number}
             * - for `mixed` type, use param `page` as index. for each index(0-based), return {data: [], maxPage: number?}, data is an array contains Comic[] or {title: string, comics: Comic[], viewMore: string?}
             */
            load: async (page) => {
                let res = await Network.get(this.baseUrl, {})
                if (res.status !== 200) {
                    throw `Invalid Status Code ${res.status}`
                }
                let document = new HtmlDocument(res.body)
                let titleBlocks = document.querySelectorAll("div.title_sort");
                let comicBlocks = document.querySelectorAll("div.bodywrap");
                if (titleBlocks.length !== comicBlocks.length) {
                    throw "Invalid Page"
                }
                let result = []
                for (let i = 0; i < titleBlocks.length; i++) {
                    let title = titleBlocks[i].querySelector("div.title_h2").text.replaceAll(/\s+/g, '')
                    let link = titleBlocks[i].querySelector("div.r > a").attributes["href"]
                    let comics = []
                    let comicBlock = comicBlocks[i]
                    let comicElements = comicBlock.querySelectorAll("div.gallary_wrap > ul.cc > li")
                    for (let comicElement of comicElements) {
                        comics.push(this.parseComic(comicElement))
                    }
                    result.push({
                        title: title,
                        comics: comics,
                        viewMore: `category:${title}@${link}`
                    })
                }
                document.dispose()
                return result
            }
        }
    ]

    // categories
    category = {
        /// title of the category page, used to identify the page, it should be unique
        title: "紳士漫畫",
        parts: [
            {
                // title of the part
                name: "更新",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["更新"],

                // category or search
                // if `category`, use categoryComics.load to load comics
                // if `search`, use search.load to load comics
                itemType: "category",

                // [Optional] {string[]?} must have same length as categories, used to provide loading param for each category
                categoryParams: ["/albums.html"],

                // [Optional] {string} cannot be used with `categoryParams`, set all category params to this value
                groupParam: null,
            },
            {
                // title of the part
                name: "同人誌",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["同人誌", "漢化", "日語", "English", "CG畫集", "AI圖集", "3D漫畫", "Cosplay"],

                // category or search
                // if `category`, use categoryComics.load to load comics
                // if `search`, use search.load to load comics
                itemType: "category",

                // [Optional] {string[]?} must have same length as categories, used to provide loading param for each category
                categoryParams: [
                    "/albums-index-cate-5.html",
                    "/albums-index-cate-1.html",
                    "/albums-index-cate-12.html",
                    "/albums-index-cate-16.html",
                    "/albums-index-cate-2.html",
                    "/albums-index-cate-37.html",
                    "/albums-index-cate-22.html",
                    "/albums-index-cate-3.html",
                ],

                // [Optional] {string} cannot be used with `categoryParams`, set all category params to this value
                groupParam: null,
            },
            {
                // title of the part
                name: "單行本",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["單行本", "漢化", "日語", "English",],

                // category or search
                // if `category`, use categoryComics.load to load comics
                // if `search`, use search.load to load comics
                itemType: "category",

                // [Optional] {string[]?} must have same length as categories, used to provide loading param for each category
                categoryParams: [
                    "/albums-index-cate-6.html",
                    "/albums-index-cate-9.html",
                    "/albums-index-cate-13.html",
                    "/albums-index-cate-17.html",
                ],

                // [Optional] {string} cannot be used with `categoryParams`, set all category params to this value
                groupParam: null,
            },
            {
                // title of the part
                name: "雜誌&短篇",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["雜誌&短篇", "漢化", "日語", "English",],

                // category or search
                // if `category`, use categoryComics.load to load comics
                // if `search`, use search.load to load comics
                itemType: "category",

                // [Optional] {string[]?} must have same length as categories, used to provide loading param for each category
                categoryParams: [
                    "/albums-index-cate-7.html",
                    "/albums-index-cate-10.html",
                    "/albums-index-cate-14.html",
                    "/albums-index-cate-18.html",
                ],

                // [Optional] {string} cannot be used with `categoryParams`, set all category params to this value
                groupParam: null,
            },
            {
                // title of the part
                name: "韓漫",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["韓漫", "合集", "漢化", "其他",],

                // category or search
                // if `category`, use categoryComics.load to load comics
                // if `search`, use search.load to load comics
                itemType: "category",

                // [Optional] {string[]?} must have same length as categories, used to provide loading param for each category
                categoryParams: [
                    "/albums-index-cate-19.html",
                    "/albums-index-cate-38.html",
                    "/albums-index-cate-20.html",
                    "/albums-index-cate-21.html",
                ],

                // [Optional] {string} cannot be used with `categoryParams`, set all category params to this value
                groupParam: null,
            },
            {
                // 站点顶部导航的「排行」(/albums-favorite_ranking.html)，
                // 它自己的分页形态与分类页不同，见 categoryComics.load 里的 rank: 分支
                name: "排行",
                type: "fixed",
                categories: ["今日", "本週", "本月", "今年"],
                itemType: "category",
                categoryParams: [
                    "rank:day",
                    "rank:week",
                    "rank:month",
                    "rank:year",
                ],
                groupParam: null,
            },
        ],
        // enable ranking page
        enableRankingPage: true,
    }

    /// category comic loading related
    categoryComics = {
        /**
         * load comics of a category
         * @param category {string} - category name
         * @param param {string?} - category param
         * @param options {string[]} - options from optionList
         * @param page {number} - page number
         * @returns {Promise<{comics: Comic[], maxPage: number}>}
         */
        load: async (category, param, options, page) => {
            // 排序: 站点用 cookie Mpic_sortset_album 控制(见 common.js 的 sort_setting)，
            // 值取自 optionList 的 key(ct_asc / ut_desc / p_desc)，需在请求前设置。
            if (options && options[0]) {
                Network.setCookies(this.baseUrl, [
                    new Cookie({ name: "Mpic_sortset_album", value: options[0] }),
                ])
            }
            let url
            if (typeof param === "string" && param.indexOf("rank:") === 0) {
                // 收藏排行榜(分类页「排行」组)：站点分页形态与分类页不同
                const type = param.slice("rank:".length)
                url = page > 1
                    ? `${this.baseUrl}/albums-favorite_ranking-page-${page}-type-${type}.html`
                    : `${this.baseUrl}/albums-favorite_ranking-type-${type}-cate.html`
            } else {
                url = this.baseUrl + param
                if (page !== 0) {
                    if (!url.includes("-")) {
                        url = url.replaceAll(".html", "-.html");
                    }
                    url = url.replaceAll("index", "");
                    let lr = url.split("albums-");
                    lr[1] = `index-page-${page}${lr[1]}`;
                    url = `${lr[0]}albums-${lr[1]}`;
                }
            }

            let res = await Network.get(url, {})
            if (res.status !== 200) {
                throw `Invalid Status Code ${res.status}`
            }
            let document = new HtmlDocument(res.body)
            let comicElements = document.querySelectorAll("div.grid div.gallary_wrap > ul.cc > li")
            let comics = []
            for (let comicElement of comicElements) {
                comics.push(this.parseComic(comicElement))
            }
            let pagesLink = document.querySelectorAll("div.f_left.paginator > a");
            let pages = pagesLink.length > 0 ? Number(pagesLink[pagesLink.length - 1].text) : 1
            document.dispose()
            return {
                comics: comics,
                maxPage: pages,
            }
        },
        // 排序选项(站点通过 cookie Mpic_sortset_album 实现)
        optionList: [
            {
                label: "Sort",
                options: [
                    "ct_asc-創建時間",
                    "ut_desc-上傳時間",
                    "p_desc-圖片數",
                ],
            },
        ],
        ranking: {
            options: [
                "day-Day",
                "week-Week",
                "month-Month",
                "year-Year",
            ],
            load: async (option, page) => {
                let url = `${this.baseUrl}/albums-favorite_ranking-type-${option}.html`
                if (page !== 0) {
                    url = `${this.baseUrl}/albums-favorite_ranking-page-${page}-type-${option}.html`
                }

                let res = await Network.get(url, {})
                if (res.status !== 200) {
                    throw `Invalid Status Code ${res.status}`
                }

                let document = new HtmlDocument(res.body)
                let comicElements = document.querySelectorAll("div.grid div.gallary_wrap > ul.cc > li")
                let comics = []
                for (let comicElement of comicElements) {
                    comics.push(this.parseComic(comicElement))
                }

                let pagesLink = document.querySelectorAll("div.f_left.paginator > a")
                let pages = 1
                if (pagesLink.length > 0) {
                    pages = Number(pagesLink[pagesLink.length - 1].text)
                }

                document.dispose()
                return {
                    comics: comics,
                    maxPage: pages,
                }
            }
        }
    }

    /// search related
    search = {
        /**
         * load search result
         * @param keyword {string}
         * @param options {string[]} - options from optionList
         * @param page {number}
         * @returns {Promise<{comics: Comic[], maxPage: number}>}
         */
        load: async (keyword, options, page) => {
            let url = `${this.baseUrl}/search/?q=${encodeURIComponent(keyword)}&f=_all&s=create_time_DESC&syn=yes`
            if (page !== 0) {
                url += `&p=${page}`
            }
            let res = await Network.get(url, {})
            if (res.status !== 200) {
                throw `Invalid Status Code ${res.status}`
            }
            let document = new HtmlDocument(res.body)
            let comicElements = document.querySelectorAll("div.grid div.gallary_wrap > ul.cc > li")
            let comics = []
            for (let comicElement of comicElements) {
                comics.push(this.parseComic(comicElement))
            }
            let total = document.querySelectorAll("p.result > b")[0].text.replaceAll(',', '')
            const comicsPerPage = 24
            let pages = Math.ceil(Number(total) / comicsPerPage)
            document.dispose()
            return {
                comics: comics,
                maxPage: pages,
            }
        },
    }

    // favorite related
    favorites = {
        // whether support multi folders
        multiFolder: true,
        isOldToNewSort: true,
        /**
         * add or delete favorite.
         * throw `Login expired` to indicate login expired, App will automatically re-login and re-add/delete favorite
         * @param comicId {string}
         * @param folderId {string}
         * @param isAdding {boolean} - true for add, false for delete
         * @param favoriteId {string?} - [Comic.favoriteId]
         * @returns {Promise<any>} - return any value to indicate success
         */
        addOrDelFavorite: async (comicId, folderId, isAdding, favoriteId) => {
            if (!isAdding) {
                let res = await Network.get(`${this.baseUrl}/users-fav_del-id-${favoriteId}.html?ajax=true&_t=${randomDouble(0, 1)}`, {})
                if (res.status !== 200) {
                    throw 'Delete failed'
                }
            } else {
                let res = await Network.post(`${this.baseUrl}/users-save_fav-id-${comicId}.html`, {
                    'content-type': 'application/x-www-form-urlencoded'
                }, `favc_id=${folderId}`)
                if (res.status !== 200) {
                    throw 'Delete failed'
                }
            }
            return 'ok'
        },
        /**
         * load favorite folders.
         * throw `Login expired` to indicate login expired, App will automatically re-login retry.
         * if comicId is not null, return favorite folders which contains the comic.
         * @param comicId {string?}
         * @returns {Promise<{folders: {[p: string]: string}, favorited: string[]}>} - `folders` is a map of folder id to folder name, `favorited` is a list of folder id which contains the comic
         */
        loadFolders: async (comicId) => {
            let res = await Network.get(`${this.baseUrl}/users-addfav-id-210814.html`, {})
            if (res.status !== 200) {
                throw 'Load failed'
            }
            let document = new HtmlDocument(res.body)
            let data = {}
            document.querySelectorAll("option").forEach((option => {
                if (option.attributes["value"] === "") return
                data[option.attributes["value"]] = option.text
            }))
            return {
                folders: data,
                favorited: []
            }
        },
        /**
         * add a folder
         * @param name {string}
         * @returns {Promise<any>} - return any value to indicate success
         */
        addFolder: async (name) => {
            let res = await Network.post(`${this.baseUrl}/users-favc_save-id.html`, {
                'content-type': 'application/x-www-form-urlencoded'
            }, `favc_name=${encodeURIComponent(name)}`)
            if (res.status !== 200) {
                throw 'Add failed'
            }
            return 'ok'
        },
        /**
         * delete a folder
         * @param folderId {string}
         * @returns {Promise<void>} - return any value to indicate success
         */
        deleteFolder: async (folderId) => {
            let res = await Network.get(`${this.baseUrl}/users-favclass_del-id-${folderId}.html?ajax=true&_t=${randomDouble()}`, {})
            if (res.status !== 200) {
                throw 'Delete failed'
            }
            return 'ok'
        },
        /**
         * load comics in a folder
         * throw `Login expired` to indicate login expired, App will automatically re-login retry.
         * @param page {number}
         * @param folder {string?} - folder id, null for non-multi-folder
         * @returns {Promise<{comics: Comic[], maxPage: number}>}
         */
        loadComics: async (page, folder) => {
            let url = `${this.baseUrl}/users-users_fav-page-${page}-c-${folder}.html.html`
            let res = await Network.get(url, {})
            if (res.status !== 200) {
                throw `Invalid Status Code ${res.status}`
            }
            let document = new HtmlDocument(res.body)
            let comicBlocks = document.querySelectorAll("div.asTB")
            let comics = comicBlocks.map((comic) => {
                let cover = comic.querySelector("div.asTBcell.thumb > div > img").attributes["src"]
                cover = 'https:' + cover
                let time = comic.querySelector("div.box_cel.u_listcon > p.l_catg > span").text.replaceAll("創建時間：", "")
                let name = comic.querySelector("div.box_cel.u_listcon > p.l_title > a").text;
                let link = comic.querySelector("div.box_cel.u_listcon > p.l_title > a").attributes["href"];
                let id = RegExp("(?<=-aid-)[0-9]+").exec(link)[0];
                let delUrl = comic.querySelector("div.box_cel.u_listcon > p.alopt > a").attributes["onclick"];
                let favoriteId = RegExp("(?<=del-id-)[0-9]+").exec(delUrl)[0];
                return new Comic({
                    id: id,
                    title: name,
                    subtitle: time,
                    cover: cover,
                    favoriteId: favoriteId,
                })
            })
            let pages = 1
            let pagesLink = document.querySelectorAll("div.f_left.paginator > a")
            if (pagesLink.length > 0) {
                pages = Number(pagesLink[pagesLink.length - 1].text)
            }
            document.dispose()
            return {
                comics: comics,
                maxPage: pages,
            }
        }
    }

    /// single comic related
    comic = {
        /**
         * load comic info
         * @param id {string}
         * @returns {Promise<ComicDetails>}
         */
        loadInfo: async (id) => {
            // Force a stable chapter order/layout instead of using the website's saved preference.
            let res = await Network.get(`${this.baseUrl}/photos-index-page-1-aid-${id}.html?order=asc&mode=list`, {})
            if (res.status !== 200) {
                throw `Invalid Status Code ${res.status}`
            }
            let document = new HtmlDocument(res.body)
            let title = document.querySelector("div.userwrap > h2").text
            let cover = document.querySelector("div.userwrap > div.asTB > div.asTBcell.uwthumb > img").attributes["src"]
            cover = 'https:' + cover
            cover = cover.substring(0, 6) + cover.substring(8)
            let labels = document.querySelectorAll("div.asTBcell.uwconn > label")
            let category = labels[0].text.split("：")[1]
            let isSeries = document.querySelector("#sr_pub") !== null
            let tagsDom = document.querySelectorAll("div.asTBcell.uwconn a.tagshow");
            let tags = new Map()
            tags.set(isSeries ? "章節" : "頁數", [labels[1].text.split("：")[1]])
            tags.set("分類", [category])
            if (tagsDom.length > 0) {
                tags.set("標籤", tagsDom.map((e) => e.text))
            }
            let description = document.querySelector("div.asTBcell.uwconn > p").text;
            let uploader = document.querySelector("div.asTBcell.uwuinfo > a > p").text;

            let chapters
            if (isSeries) {
                chapters = new Map()
                let page = 1
                let maxPage = 1
                try {
                    while (true) {
                        for (let chapter of document.querySelectorAll("a[data-chid]")) {
                            chapters.set(chapter.attributes["data-chid"], chapter.text.trim())
                        }
                        for (let link of document.querySelectorAll("div.f_left.paginator a[href]")) {
                            // 分页链接形如 /photos-index-aid-<id>-page-<N>.html，
                            // 数字后面没有短横线，所以不能用 /-page-(\d+)-/（会匹配失败、maxPage 恒为 1，
                            // 导致只收到第 1 页 12 话，后续目录丢失）
                            let match = link.attributes["href"].match(/-page-(\d+)/)
                            if (match) maxPage = Math.max(maxPage, Number(match[1]))
                        }
                        if (page >= maxPage) break
                        page++
                        document.dispose()
                        document = null
                        let chapterRes = await Network.get(`${this.baseUrl}/photos-index-page-${page}-aid-${id}.html?order=asc&mode=list`, {})
                        if (chapterRes.status !== 200) {
                            throw `Invalid Status Code ${chapterRes.status}`
                        }
                        document = new HtmlDocument(chapterRes.body)
                    }
                } finally {
                    if (document) document.dispose()
                }
                if (chapters.size === 0) throw 'Invalid chapter directory'
            } else {
                document.dispose()
            }

            return new ComicDetails({
                id: id,
                title: title,
                cover: cover,
                chapters: chapters,
                tags: tags,
                description: description,
                uploader: uploader,
            })
        },
        /**
         * [Optional] load thumbnails of a comic
         * @param id {string}
         * @param next {string | null | undefined} - next page token, null for first page
         * @returns {Promise<{thumbnails: string[], next: string?}>} - `next` is next page token, null for no more
         */
        loadThumbnails: async (id, next) => {
            next = next || '1'
            let res = await Network.get(`${this.baseUrl}/photos-index-page-${next}-aid-${id}.html`, {});
            if (res.status !== 200) {
                throw `Invalid Status Code ${res.status}`
            }
            let document = new HtmlDocument(res.body)
            if (document.querySelector("#sr_pub")) {
                document.dispose()
                return { thumbnails: [], next: null }
            }
            let thumbnails = document.querySelectorAll("div.pic_box.tb > a > img").map((e) => {
                return 'https:' + e.attributes["src"]
            })
            next = (Number(next) + 1).toString()
            let paginator = document.querySelector("div.f_left.paginator")
            let pagesLink = paginator ? paginator.children : []
            if (pagesLink.length === 0 || pagesLink[pagesLink.length - 1].classNames.includes("thispage")) {
                next = null
            }
            document.dispose()
            return {
                thumbnails: thumbnails,
                next: next
            }
        },
        /**
         * load images of a chapter
         * @param comicId {string}
         * @param epId {string?}
         * @returns {Promise<{images: string[]}>}
         */
        loadEp: async (comicId, epId) => {
            let res = await Network.get(`${this.baseUrl}/photos-gallery-aid-${epId || comicId}.html`, {})
            if (res.status !== 200) {
                throw `Invalid Status Code ${res.status}`
            }
            const regex = RegExp(String.raw`//[^"]+/[^"]+\.[^"]+`, 'g');
            const matches = Array.from(res.body.matchAll(regex));
            return {
                images: matches.map((e) => 'https:' + e[0].substring(0, e[0].length - 1))
            }
        },
        /**
         * [Optional] Handle tag click event
         * @param namespace {string}
         * @param tag {string}
         * @returns {{action: string, keyword: string, param: string?}}
         */
        onClickTag: (namespace, tag) => {
            return {
                action: 'search',
                keyword: tag,
            }
        },
    }

    get settings() {
        // 动态生成选项，总是保留 Custom Domain (0)，然后根据 Wnacg.domains 数量添加选项
        let domainOptions = [{ value: '0', text: 'Custom Domain' }]
        for (let i = 0; i < Wnacg.domains.length; i++) {
            domainOptions.push({
                value: String(i + 1),
                text: Wnacg.domains[i]
            })
        }

        return {
            refreshDomains: {
                title: "Refresh Domain List",
                type: "callback",
                buttonText: "Refresh",
                callback: () => this.refreshDomains(true)
            },
            refreshDomainsOnStart: {
                title: "Refresh Domain List on Startup",
                type: "switch",
                default: true,
            },
            domainSelection: {
                title: "Domain Selection",
                type: "select",
                options: domainOptions,
                default: "0",
            },
            domain0: {
                title: "Custom Domain",
                type: "input",
                validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
                default: 'wnacg.com',
            },
        }
    }

    translation = {
        'zh_CN': {
            'Refresh Domain List': '刷新域名列表',
            'Refresh': '刷新',
            'Refresh Domain List on Startup': '启动时刷新域名列表',
            'Domain Selection': '域名选择',
            'Custom Domain': '自定义域名',
            'Custom domain is not set': '未设置自定义域名',
            'Selected domain is unavailable': '所选域名不可用，请先刷新域名列表',
            'Sort': '排序',
            '創建時間': '创建时间',
            '上傳時間': '上传时间',
            '圖片數': '图片数',
            'Day': '日',
            'Week': '周',
            'Month': '月',
            'Year': '年',
        },
        'zh_TW': {
            'Refresh Domain List': '刷新域名列表',
            'Refresh': '刷新',
            'Refresh Domain List on Startup': '啟動時刷新域名列表',
            'Domain Selection': '域名選擇',
            'Custom Domain': '自定義域名',
            'Custom domain is not set': '未設置自定義域名',
            'Selected domain is unavailable': '所選域名不可用，請先刷新域名列表',
            'Sort': '排序',
            'Day': '日',
            'Week': '周',
            'Month': '月',
            'Year': '年',
        },
    }
}
