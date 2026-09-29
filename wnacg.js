class Wnacg extends ComicSource {
    // Note: The fields which are marked as [Optional] should be removed if not used

    // name of the source
    name = "紳士漫畫"

    // unique id of the source
    key = "wnacg"

    version = "1.0.10"

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
    /// 抓一个列表页，取前 8 部
    async _loadList(url) {
        let res = await Network.get(this.baseUrl + url, {})
        if (res.status !== 200) {
            throw `Invalid Status Code ${res.status}`
        }
        let document = new HtmlDocument(res.body)
        let comics = []
        for (let el of document.querySelectorAll("div.grid div.gallary_wrap > ul.cc > li")) {
            comics.push(this.parseComic(el))
        }
        document.dispose()
        return comics.slice(0, 8)
    }

    // 固定板块: 排行榜 + 各分组下的子分类
    // url  : 板块内容用(取前 8)
    // param: "查看更多"用。rank:xx 表示排行榜(分页形态与分类页不同)，其余为分类页路径
    _extraBoards() {
        return [
            { title: "排行", alias: ["排行榜", "排行总览"], url: "/albums-favorite_ranking.html", param: "rank:week" },
            { title: "排行·今日", alias: ["今日排行"], url: "/albums-favorite_ranking-type-day-cate.html", param: "rank:day" },
            { title: "排行·本週", alias: ["本週排行"], url: "/albums-favorite_ranking-type-week-cate.html", param: "rank:week" },
            { title: "排行·本月", alias: ["本月排行"], url: "/albums-favorite_ranking-type-month-cate.html", param: "rank:month" },
            { title: "排行·今年", alias: ["今年排行"], url: "/albums-favorite_ranking-type-year-cate.html", param: "rank:year" },

            { title: "同人誌·漢化", alias: ["同人漢化"], url: "/albums-index-cate-1.html", param: "/albums-index-cate-1.html" },
            { title: "同人誌·日語", alias: ["同人日語"], url: "/albums-index-cate-12.html", param: "/albums-index-cate-12.html" },
            { title: "同人誌·English", alias: [], url: "/albums-index-cate-16.html", param: "/albums-index-cate-16.html" },
            { title: "同人誌·CG畫集", alias: ["同人CG畫集"], url: "/albums-index-cate-2.html", param: "/albums-index-cate-2.html" },
            { title: "同人誌·AI圖集", alias: ["同人AI圖集"], url: "/albums-index-cate-37.html", param: "/albums-index-cate-37.html" },
            { title: "同人誌·3D漫畫", alias: ["同人3D漫畫"], url: "/albums-index-cate-22.html", param: "/albums-index-cate-22.html" },
            { title: "同人誌·Cosplay", alias: ["同人Cosplay"], url: "/albums-index-cate-3.html", param: "/albums-index-cate-3.html" },

            { title: "單行本·漢化", alias: [], url: "/albums-index-cate-9.html", param: "/albums-index-cate-9.html" },
            { title: "單行本·日語", alias: [], url: "/albums-index-cate-13.html", param: "/albums-index-cate-13.html" },
            { title: "單行本·English", alias: [], url: "/albums-index-cate-17.html", param: "/albums-index-cate-17.html" },

            { title: "雜誌短篇·漢化", alias: [], url: "/albums-index-cate-10.html", param: "/albums-index-cate-10.html" },
            { title: "雜誌短篇·日語", alias: [], url: "/albums-index-cate-14.html", param: "/albums-index-cate-14.html" },
            { title: "雜誌短篇·English", alias: [], url: "/albums-index-cate-18.html", param: "/albums-index-cate-18.html" },
        ]
    }

    /**
     * 按源设置里的"板块顺序"筛选并重排板块。
     * 填了哪些就显示哪些、按填的顺序；没填的不显示；清空则全部按默认顺序显示。
     * 每项可用板块名/别名/编号(默认顺序的 1 基序号)，分隔符 , ， 、 ; ； 空格
     */
    _orderParts(parts) {
        const raw = this.loadSetting('boardOrder') || ''
        const tokens = String(raw)
            .split(/[,，、;；\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
        if (tokens.length == 0) return parts
        const used = new Set()
        const ordered = []
        for (const token of tokens) {
            let index = -1
            if (/^\d+$/.test(token)) {
                const i = parseInt(token, 10) - 1
                if (i >= 0 && i < parts.length && !used.has(i)) index = i
            } else {
                const t = token.toLowerCase()
                // 先全量精确匹配，再退回包含匹配。
                // 否则 "排行·本週" 会被 "排行" 抢先命中(t.includes(m))
                index = parts.findIndex(
                    (p, i) => !used.has(i) && p.match.some((m) => m.toLowerCase() === t)
                )
                if (index < 0) {
                    index = parts.findIndex(
                        (p, i) =>
                            !used.has(i) &&
                            p.match.some(
                                (m) =>
                                    m.toLowerCase().includes(t) ||
                                    t.includes(m.toLowerCase())
                            )
                    )
                }
            }
            if (index >= 0) {
                used.add(index)
                ordered.push(parts[index])
            }
        }
        return ordered
    }

    explore = [
        {
            // title of the page.
            // title is used to identify the page, it should be unique
            title: "紳士漫畫",

            /// multiPartPage or multiPageComicList or mixed
            type: "multiPartPage",

            load: async () => {
                // 候选顺序 = 固定板块 + 首页板块，与源设置"可选板块"列表的编号一一对应
                const boards = this._extraBoards()
                const extraUrls = new Set(boards.map((b) => b.url))
                // 首页板块标题改名(标注这是分组总览, 区别于子分类板块)
                const titleOverride = {
                    "/albums-index-cate-5.html": "同人誌CG畫集(总览)",
                }

                // 1) 固定板块的"骨架"(内容稍后按需加载)
                const fixed = boards.map((b) => ({
                    title: b.title,
                    match: [b.title].concat(b.alias),
                    comics: null,
                    extra: b,
                    viewMore: {
                        page: "category",
                        attributes: { category: b.title, param: b.param },
                    },
                }))

                // 2) 首页板块(内容直接来自首页 HTML，无需额外请求)。
                //    站点结构变化时自动跟随；与固定板块指向同一页的会丢弃。
                //    首页拿不到时只保留固定板块，不让整页失败。
                const home = []
                try {
                    let res = await Network.get(this.baseUrl, {})
                    if (res.status === 200) {
                        let document = new HtmlDocument(res.body)
                        let titleBlocks = document.querySelectorAll("div.title_sort")
                        let comicBlocks = document.querySelectorAll("div.bodywrap")
                        for (let i = 0; i < titleBlocks.length; i++) {
                            let link = titleBlocks[i].querySelector("div.r > a").attributes["href"]
                            if (extraUrls.has(link)) continue
                            let title = titleOverride[link] ||
                                titleBlocks[i].querySelector("div.title_h2").text.replaceAll(/\s+/g, '')
                            let comics = []
                            for (let el of comicBlocks[i].querySelectorAll("div.gallary_wrap > ul.cc > li")) {
                                comics.push(this.parseComic(el))
                            }
                            home.push({
                                title: title,
                                match: [title],
                                comics: comics,
                                extra: null,
                                viewMore: {
                                    page: "category",
                                    attributes: { category: title, param: link },
                                },
                            })
                        }
                        document.dispose()
                    }
                } catch (e) {}

                // 3) 按"板块顺序"挑出要显示的板块(编号与可选板块一致)
                const selected = this._orderParts(fixed.concat(home))

                // 4) 只加载被选中的固定板块，串行 + 间隔。
                //    站点在 Cloudflare 后面，并发一多就会被 challenge(429/500)；
                //    单个板块失败只跳过该板块，不影响整页。
                const result = []
                for (const part of selected) {
                    if (!part.extra) {
                        result.push({ title: part.title, comics: part.comics, viewMore: part.viewMore })
                        continue
                    }
                    try {
                        part.comics = await this._loadList(part.extra.url)
                    } catch (e) {
                        continue
                    }
                    result.push({ title: part.title, comics: part.comics, viewMore: part.viewMore })
                    await new Promise((resolve) => setTimeout(resolve, 150))
                }
                return result
            },
        }
    ]

    // categories
    category = {
        /// title of the category page, used to identify the page, it should be unique
        title: "紳士漫畫",
        parts: [
            {
                // title of the part
                name: "最新",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["最新"],

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

                categories: ["同人誌", "漢化", "日語", "English", "CG畫集", "AI圖集", "3D漫畫", "寫真Cosplay"],

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
                name: "雜誌短篇",

                // fixed or random
                // if random, need to provide `randomNumber` field, which indicates the number of comics to display at the same time
                type: "fixed",

                // number of comics to display at the same time
                // randomNumber: 5,

                categories: ["雜誌短篇", "漢化", "日語", "English",],

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

                categories: ["韓漫", "漢化", "生肉",],

                // category or search
                // if `category`, use categoryComics.load to load comics
                // if `search`, use search.load to load comics
                itemType: "category",

                // [Optional] {string[]?} must have same length as categories, used to provide loading param for each category
                categoryParams: [
                    "/albums-index-cate-19.html",
                    "/albums-index-cate-20.html",
                    "/albums-index-cate-21.html",
                ],

                // [Optional] {string} cannot be used with `categoryParams`, set all category params to this value
                groupParam: null,
            },
        ],
        // enable ranking page
        enableRankingPage: true,
    }

    /// category comic loading related
    categoryComics = {
        load: async (category, param, options, page) => {
            // 排序: 站点用 cookie Mpic_sortset_album 控制(见 common.js 的 sort_setting)
            if (options && options[0]) {
                Network.setCookies(this.baseUrl, [
                    new Cookie({ name: "Mpic_sortset_album", value: options[0] }),
                ])
            }
            let url
            if (typeof param === "string" && param.indexOf("rank:") === 0) {
                // 排行榜的分页形态与分类页不同
                const type = param.slice("rank:".length)
                url = page > 1
                    ? `${this.baseUrl}/albums-favorite_ranking-page-${page}-type-${type}.html`
                    : `${this.baseUrl}/albums-favorite_ranking-type-${type}-cate.html`
            } else {
                url = this.baseUrl + param
                if (page !== 0) {
                    if (!url.includes("-")) {
                        url = url.replaceAll(".html", "-.html")
                    }
                    url = url.replaceAll("index", "")
                    let lr = url.split("albums-")
                    lr[1] = `index-page-${page}${lr[1]}`
                    url = `${lr[0]}albums-${lr[1]}`
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
            let pages = Number(pagesLink[pagesLink.length - 1].text)
            document.dispose()
            return {
                comics: comics,
                maxPage: pages,
            }
        },
        // 排序选项(站点通过 cookie 实现)
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
                let info = comic.querySelector("div.box_cel.u_listcon > p.l_detla").text;
                let pages = Number(RegExp("(?<=頁數：)[0-9]+").exec(info)[0])
                let delUrl = comic.querySelector("div.box_cel.u_listcon > p.alopt > a").attributes["onclick"];
                let favoriteId = RegExp("(?<=del-id-)[0-9]+").exec(delUrl)[0];
                return new Comic({
                    id: id,
                    title: name,
                    subtitle: time,
                    cover: cover,
                    pages: pages,
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
            let res = await Network.get(`${this.baseUrl}/photos-index-page-1-aid-${id}.html`, {})
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

            // 站点现在有两套详情页结构：
            //  新结构(多话本): 详情页给的是"目录"，章节链接指向 photos-slide-aid-<章>-sid-<本>，
            //                 此时 a.tagshow 是章节而不是标签
            //  老结构(单本):   详情页给的是"预览"(div.pic_box.tb)，a.tagshow 才是标签
            let chapters = new Map()
            let tagsDom = []
            let pages
            let chapterLinks = document.querySelectorAll(
                `a[href*="photos-slide-aid-"][href*="-sid-${id}.html"]`
            )
            if (chapterLinks.length > 0) {
                for (const link of chapterLinks) {
                    let m = /photos-slide-aid-(\d+)-sid-/.exec(link.attributes["href"])
                    if (!m || chapters.has(m[1])) continue
                    let text = link.text.trim()
                    // 跳过"開始閱讀"按钮(与第一话指向同一页)
                    if (!text || text.indexOf("開始閱讀") >= 0 || text.indexOf("开始阅读") >= 0) continue
                    chapters.set(m[1], text)
                }
                pages = `${chapters.size} 話`
            } else {
                pages = labels[1].text.split("：")[1]
                tagsDom = document.querySelectorAll("a.tagshow")
            }

            let tags = new Map()
            tags.set("分類", [category])
            tags.set(chapters.size > 0 ? "章節" : "頁數", [pages])
            if (tagsDom.length > 0) {
                tags.set("標籤", tagsDom.map((e) => e.text))
            }
            let descDom = document.querySelector("div.asTBcell.uwconn > p")
            let description = descDom ? descDom.text : ""
            let upDom = document.querySelector("div.asTBcell.uwuinfo > a > p")
            let uploader = upDom ? upDom.text : ""

            return new ComicDetails({
                id: id,
                title: title,
                cover: cover,
                pages: pages,
                tags: tags,
                description: description,
                uploader: uploader,
                chapters: chapters.size > 0 ? chapters : null,
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
            let previewImgs = document.querySelectorAll("div.pic_box.tb > a > img")
            if (previewImgs.length === 0) {
                // 新结构(多话本)站点只给目录，不提供预览图
                return {
                    thumbnails: [],
                    next: null
                }
            }
            let thumbnails = previewImgs.map((e) => {
                return 'https:' + e.attributes["src"]
            })
            next = (Number(next) + 1).toString()
            let pagesLink = document.querySelector("div.f_left.paginator").children
            if (pagesLink[pagesLink.length - 1].classNames.includes("thispage")) {
                next = null
            }
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
            if (epId) {
                // 新结构(有目录): 图片在 photos-item-aid-<章节aid>.html 的
                // mReader.initData({page_url:[...]}) 里。注意数组带尾逗号，不能直接 JSON.parse，
                // 且站点给的是 http(不通)，必须换成 https。
                let res = await Network.get(`${this.baseUrl}/photos-item-aid-${epId}.html`, {})
                if (res.status !== 200) {
                    throw `Invalid Status Code ${res.status}`
                }
                let m = /"page_url"\s*:\s*\[([\s\S]*?)\]/.exec(res.body)
                if (m) {
                    let images = Array.from(m[1].matchAll(/"(https?:[^"]+)"/g))
                        .map((e) => e[1].replace(/^http:/, "https:"))
                    if (images.length > 0) {
                        return { images: images }
                    }
                }
                throw "Failed to parse chapter images"
            }
            // 老结构(无目录): 从 gallery 页正则提取
            let res = await Network.get(`${this.baseUrl}/photos-gallery-aid-${comicId}.html`, {})
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
            boardOrder: {
                title: "Board order",
                type: "input",
                default: '11,10,3,4,9,12,19,23,6',
                validator: null,
            },
            boardOrderList: {
                title: "Available boards",
                type: "callback",
                buttonText: "Show",
                callback: async () => {
                    const boards = this._extraBoards()
                    const extraUrls = new Set(boards.map((b) => b.url))
                    const names = boards.map((b) => b.title)
                    try {
                        const res = await Network.get(this.baseUrl, {})
                        if (res.status === 200) {
                            const doc = new HtmlDocument(res.body)
                            for (const b of doc.querySelectorAll("div.title_sort")) {
                                const link = b.querySelector("div.r > a").attributes["href"]
                                if (extraUrls.has(link)) continue
                                names.push(b.querySelector("div.title_h2").text.replaceAll(/\s+/g, ""))
                            }
                            doc.dispose()
                        }
                    } catch (e) {}
                    UI.showDialog(
                        "Available boards",
                        names.map((n, i) => `${i + 1}. ${n}`).join("\n"),
                        [{ text: "OK", callback: () => {} }]
                    )
                },
            },
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
            'Day': '日',
            'Week': '周',
            'Month': '月',
            'Year': '年',
            'Board order': '板块顺序',
            'Available boards': '可选板块',
            'Sort': '排序',
            '創建時間': '创建时间',
            '上傳時間': '上传时间',
            '圖片數': '图片数',
            '总览': '总览',
        },
        'zh_TW': {
            'Refresh Domain List': '刷新域名列表',
            'Refresh': '刷新',
            'Refresh Domain List on Startup': '啟動時刷新域名列表',
            'Domain Selection': '域名選擇',
            'Custom Domain': '自定義域名',
            'Custom domain is not set': '未設置自定義域名',
            'Selected domain is unavailable': '所選域名不可用，請先刷新域名列表',
            'Day': '日',
            'Week': '周',
            'Month': '月',
            'Year': '年',
            'Board order': '看板順序',
            'Available boards': '可選板塊',
            'Sort': '排序',
            '总览': '總覽',
        },
    }
}





