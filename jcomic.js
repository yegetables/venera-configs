/** @type {import('./_venera_.js')} */

// ===== 镜像站配置：要换镜像站只改这两行 =====
// 站点域名（不带协议）。也可以在 App 的源设置「站点域名」里覆盖，无需改代码。
const JCOMIC_DOMAIN = "jcomic.net";
// 图片 CDN 主机名。留空 => 自动按 "images." + 站点域名 推导。
const JCOMIC_IMAGE_HOST = "";

function trimTitle(raw) {
  if (!raw) return "";
  const idx = raw.lastIndexOf(" (");
  if (idx > 0) return raw.slice(0, idx).trim();
  return raw.trim();
}

function parseIdFromHref(href) {
  if (!href) return null;
  try {
    const u = href.split("?")[0];
    const parts = u.split("/").filter(Boolean); // 过滤空字符串
    if (parts.length >= 2) {
      return decodeURIComponent(parts[1]);
    }
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return null;
  }
}

function parseEpIdFromHref(href) {
  if (!href) return null;
  const u = href.split("?")[0];
  const parts = u.split("/").filter(Boolean);
  if (parts.length >= 3) {
    return decodeURIComponent(parts[2]);
  }
  return null;
}

/**
 * 解码章节页图片的真实 URL。
 * 站点改版后 img 的真实地址不在 src 里，而是编码在 data-locked 属性:
 *   data-locked = "JCOMIC_TRAPS_" + 反转(base64(真实URL))
 * 解码步骤: 去掉前缀 -> 反转 -> 补齐 base64 padding -> base64 解码。
 * @param {string} locked - data-locked 属性值
 * @returns {string} 真实图片 URL，失败返回 ""
 */
function decodeLockedImageUrl(locked) {
  if (!locked || typeof locked !== "string") return "";
  const m = /^JCOMIC_TRAPS?_(.*)$/.exec(locked);
  if (!m) return "";
  try {
    let s = m[1].split("").reverse().join("").replace(/=/g, "")
      .replace(/-/g, "+").replace(/_/g, "/");
    s += "=".repeat((4 - (s.length % 4)) % 4);
    return Convert.decodeUtf8(Convert.decodeBase64(s));
  } catch (e) {
    return "";
  }
}

/**
 * 解析作品卡片 -> Comic
 * @param {Element} card
 */
function parseComicCard(card) {
  try {
    const link = card.querySelector('a[href^="/eps/"], a[href^="/page/"]');
    if (!link) return null;
    const href = link.attributes["href"];
    const id = parseIdFromHref(href);
    if (!id) return null;

    const img = card.querySelector("img.comic-thumb");
    const cover = img ? img.attributes["src"] : "";

    const titleEl = card.querySelector("p.comic-title");
    const rawTitle = titleEl ? titleEl.text.trim() : id;
    const title = trimTitle(rawTitle);

    // 作者
    const authorButtons = card.querySelectorAll('a[href^="/author/"] button');
    const authors = Array.from(authorButtons).map((b) => b.text.trim());
    const subTitle = authors.join(" ");

    // 分类标签
    const catButtons = card.querySelectorAll('a[href^="/cat/"] button');
    let tags = [];
    if (catButtons.length) {
        tags = Array.from(catButtons).map((b) => b.text.trim());
    } else {
    // 有些结构是 a[href^="/cat/..."] 包着文字
    const catAnchors = card.querySelectorAll('a[href^="/cat/"]');
    tags = Array.from(catAnchors)
    .map((a) => a.text.trim())
    .filter(Boolean);
}   

    // 最后更新
    const dateEl = card.querySelector("p.comic-date");
    const description = dateEl ? dateEl.text.trim() : "";

    return new Comic({
      id,
      title,
      subTitle,
      cover,
      tags,
      language: "zh-Hant",
      description,
    });
  } catch (e) {
    return null;
  }
}

/**
 * 通用：解析分页最大页数
 * @param {HtmlDocument} doc
 */
function parseMaxPage(doc) {
  const pag = doc.querySelector("ul.pagination");
  if (!pag) return 1;
  const as = pag.querySelectorAll("a");
  let max = 1;
  as.forEach((a) => {
    const t = a.text.trim();
    const n = parseInt(t, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  });
  return max;
}

/**
 * 通用：解析列表页所有作品
 * @param {HtmlDocument} doc
 */
function parseComicList(doc) {
  const cards = doc.querySelectorAll(
    'div.row.col-lg-4.col-md-6.col-xs-12, div.row.col-md-6.col-xs-12'
  );
  const result = [];
  cards.forEach((card) => {
    const c = parseComicCard(card);
    if (c) result.push(c);
  });
  return result;
}

class JComic extends ComicSource {
  name = "jcomic.net";
  key = "jcomic";

  version = "1.0.2";
  minAppVersion = "1.4.6";

  url =
    "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/jcomic.js";

  currentComic = null;

  // —— 站点与图片地址一律由顶部 JCOMIC_DOMAIN / JCOMIC_IMAGE_HOST（可被源设置覆盖）推导 ——
  //    不要在别处写死地址，换镜像站时只改顶部配置。
  get _domain() {
    const raw = this.loadSetting("domain");
    const d = String(raw == null ? "" : raw)
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
    return d || JCOMIC_DOMAIN;
  }

  get _base() {
    return "https://" + this._domain;
  }

  get _referer() {
    return this._base + "/";
  }

  // 图片主机：默认跟随站点域名（images.<域名>），可用顶部常量覆盖
  get _imageHost() {
    return JCOMIC_IMAGE_HOST || "images." + this._domain;
  }

  // 把站点返回的图片地址改写到当前配置的图片主机（保留路径与查询串）。
  // 默认配置下与站点原地址一致，等于直通；换镜像站时图片自动跟随。
  _toImageUrl(url) {
    if (!url) return "";
    const m = /^(?:https?:)?\/\/[^\/]+(\/[\s\S]*)$/.exec(url);
    if (m) return "https://" + this._imageHost + m[1];
    if (url.startsWith("/")) return "https://" + this._imageHost + url;
    return url;
  }

  _buildUrl(path) {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (!path.startsWith("/")) path = "/" + path;
    return this._base + path;
  }

  get settings() {
    return {
      domain: {
        title: "Site domain",
        type: "input",
        default: JCOMIC_DOMAIN,
        validator: String.raw`^(?!:\/\/)(?=.{1,253})([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`,
      },
    };
  }

  /**
   * [Optional] init
   */
  init() {
    // 让「打开链接」识别跟随配置的域名（含镜像站）
    const d = this._domain;
    const domains = this.comic && this.comic.link && this.comic.link.domains;
    if (domains && !domains.includes(d)) domains.push(d);
  }

  /// explore
  explore = [
    {
      title: "JComic",
      type: "multiPageComicList",
      load: async (page) => {
        if (!page) page = 1;
        const cat = "最近更新";
        const encoded = encodeURI(cat);
        const path = page === 1 ? `/cat/${encoded}` : `/cat/${encoded}/${page}`;
        const url = this._buildUrl(path);

        const resp = await Network.get(url, { referer: this._referer });
        if (resp.status !== 200) throw new Error(resp.status);

        const doc = new HtmlDocument(resp.body);
        const comics = parseComicList(doc);
        const maxPage = parseMaxPage(doc);

        return { comics, maxPage };
      },
      loadNext(next) {},
    },
  ];

  // 分类列表
  category = {
    title: "jcomic.net",
    parts: [
      {
        name: "分類",
        type: "fixed",
        categories: [
          "最近更新",
          "隨機",
          "全彩",
          "長篇",
          "單行本",
          "同人",
          "短篇",
          "Cosplay",
          "歐美",
          "WEBTOON",
          "圓神領域",
          "碧藍幻想",
          "CG雜圖",
          "英語 ENG",
          "生肉",
          "純愛",
          "百合花園",
          "耽美花園",
          "偽娘哲學",
          "後宮閃光",
          "扶他樂園",
          "姐姐系",
          "妹妹系",
          "SM",
          "性轉換",
          "足の恋",
          "重口地帶",
          "人妻",
          "NTR",
          "強暴",
          "非人類",
          "艦隊收藏",
          "Love Live",
          "SAO 刀劍神域",
          "Fate",
          "東方",
          "禁書目錄",
        ],
        itemType: "category",
        categoryParams: [
          "最近更新",
          "隨機",
          "全彩",
          "長篇",
          "單行本",
          "同人",
          "短篇",
          "Cosplay",
          "歐美",
          "WEBTOON",
          "圓神領域",
          "碧藍幻想",
          "CG雜圖",
          "英語 ENG",
          "生肉",
          "純愛",
          "百合花園",
          "耽美花園",
          "偽娘哲學",
          "後宮閃光",
          "扶他樂園",
          "姐姐系",
          "妹妹系",
          "SM",
          "性轉換",
          "足の恋",
          "重口地帶",
          "人妻",
          "NTR",
          "強暴",
          "非人類",
          "艦隊收藏",
          "Love Live",
          "SAO 刀劍神域",
          "Fate",
          "東方",
          "禁書目錄",
        ],
      },
    ],
    enableRankingPage: false,
  };

  categoryComics = {
    /**
     * @param category {string}
     * @param param {string} 
     * @param options {string[]}
     * @param page {number}
     */
    load: async (category, param, options, page) => {
      if (!page) page = 1;
      const encoded = encodeURI(param);
      const path = page === 1 ? `/cat/${encoded}` : `/cat/${encoded}/${page}`;
      const url = this._buildUrl(path);

      const resp = await Network.get(url, { referer: this._referer });
      if (resp.status !== 200) throw new Error(resp.status);

      const doc = new HtmlDocument(resp.body);
      const comics = parseComicList(doc);
      const maxPage = parseMaxPage(doc);

      return { comics, maxPage };
    },
    optionList: [],
    ranking: null,
  };

  /// 搜索
  search = {
    /**
     * @param keyword {string}
     * @param options {string[]}
     * @param page {number}
     */
    load: async (keyword, options, page) => {
      if (!page) page = 1;
      const kw = (keyword || "").trim();
      if (!kw) {
        return { comics: [], maxPage: 1 };
      }
      const encoded = encodeURIComponent(kw);
      const path = page === 1 ? `/search/${encoded}` : `/search/${encoded}/${page}`;
      const url = this._buildUrl(path);

      const resp = await Network.get(url, { referer: this._referer });
      if (resp.status !== 200) throw new Error(resp.status);

      const doc = new HtmlDocument(resp.body);
      const comics = parseComicList(doc);
      const maxPage = parseMaxPage(doc);

      return { comics, maxPage };
    },
    loadNext: async (keyword, options, next) => {},
    optionList: [
      {
        type: "select",
        options: ["0-Default"],
        label: "sort",
        default: null,
      },
    ],
    enableTagsSuggestions: false,
  };

  /// 单本漫画
  comic = {
    /**
     * 载入漫画信息和章节列表
     * @param id {string} - 原始标题字符串
     * @returns {Promise<ComicDetails>}
     */
    loadInfo: async (id) => {
      const encodedId = encodeURI(id);
      const url = this._buildUrl(`/eps/${encodedId}`);
      const resp = await Network.get(url, { referer: this._referer });
      if (resp.status !== 200) throw new Error(resp.status);

      const doc = new HtmlDocument(resp.body);

      const infoBlock = doc.querySelector(
        'div.row.col-md-6.col-xs-12'
      );
      if (!infoBlock) {
        throw new Error("failed to parse comic info");
      }

      // 标题和总页数
      const titleEl = infoBlock.querySelector("p.comic-title");
      const rawTitle = titleEl ? titleEl.text.trim() : id;
      const title = trimTitle(rawTitle);
      let totalPages = 1;
      const pageMatch = /\((\d+)\)/.exec(rawTitle);
      if (pageMatch) {
        totalPages = parseInt(pageMatch[1], 10) || 1;
      }

      // 封面
      const img = infoBlock.querySelector("img.comic-thumb");
      const cover = img ? img.attributes["src"] : "";

      // 作者
      const authorButtons = infoBlock.querySelectorAll(
        'a[href^="/author/"] button'
      );
      const authors = Array.from(authorButtons).map((b) => b.text.trim());

      // 分类标签
      const catButtons = infoBlock.querySelectorAll('a[href^="/cat/"] button');
      const categories = Array.from(catButtons).map((b) => b.text.trim());

      // 更新时间
      const dateEl = infoBlock.querySelector("p.comic-date");
      const uploadTime = dateEl ? dateEl.text.trim() : "";

      // 章节列表
      const allPageLinks = doc.querySelectorAll('a[href^="/page/"]');
      let eps = [];
      
      allPageLinks.forEach((a) => {
        const href = a.attributes["href"];
        // 检查这个链接是否属于当前漫画
        const linkComicId = parseIdFromHref(href);
        if (linkComicId === id) {
          const epId = parseEpIdFromHref(href);
          if (epId) {
            let text = a.text.trim();
            if (!text) {
              const btn = a.querySelector("button");
              if (btn) text = btn.text.trim();
            }
            eps.push({
              id: epId,
              title: text || `第${epId}話`,
            });
          }
        }
      });

      // tags Map
      const tags = new Map();
      if (authors.length) tags.set("authors", authors);
      if (categories.length) tags.set("categories", categories);

      // 构建 chapters Map
      const chapters = new Map();
      eps.forEach((ep) => {
        chapters.set(ep.id, ep.title);
      });

      this.currentComic = {
        id,
        title,
        cover,
        authors,
        categories,
        eps,
      };

      return new ComicDetails({
        title,
        cover,
        tags,
        chapters,
        maxPage: totalPages,
        thumbnails: [cover],
        uploadTime,
        url: url,
        recommend: undefined,
      });
    },

    /**
     * 载入章节图片
     * @param comicId {string}
     * @param epId {string}
     * @returns {Promise<{images: string[]}>}
     */
    loadEp: async (comicId, epId) => {
      const encodedComicId = encodeURI(comicId);
      let path = `/page/${encodedComicId}`;
      if (epId) {
        // epId 里可能有 11.5、14.2 等，直接当原始字符串 encode 一下
        path += "/" + encodeURIComponent(epId);
      }
      const url = this._buildUrl(path);

      const resp = await Network.get(url, { referer: this._referer });
      if (resp.status !== 200) throw new Error(resp.status);

      const doc = new HtmlDocument(resp.body);
      const imgs = doc.querySelectorAll("img.comic-thumb");
      const images = [];
      imgs.forEach((img) => {
        const attrs = img.attributes;
        images.push(
          this._toImageUrl(
            decodeLockedImageUrl(attrs["data-locked"]) || attrs["src"] || ""
          )
        );
      });
      doc.dispose();

      return { images: images.filter(Boolean) };
    },

    onImageLoad: (url, comicId, epId) => {
      return {
        url: this._toImageUrl(url),
        headers: {
          referer: this._referer,
        },
      };
    },

    onThumbnailLoad: (url) => {
      return {
        url: this._toImageUrl(url),
        headers: {
          referer: this._referer,
        },
      };
    },

    onClickTag: (namespace, tag) => {
      const keyword = tag; 
      return {
        page: "category",
        attributes: {
          category: "分類",
          param: keyword,
        },
      };
    },

    link: {
      domains: [JCOMIC_DOMAIN],
      linkToId: (url) => {
        // 主机名不写死，换镜像站后同样能识别
        const reg = /https?:\/\/[^\/]+\/(?:eps|page)\/([^\/?#]+)(?:\/[^\/?#]+)?/;
        const m = reg.exec(url);
        if (!m) throw new Error("Invalid jcomic url");
        return decodeURIComponent(m[1]);
      },
    },
  };

  translation = {
    zh_CN: {
      "Site domain": "站点域名",
    },
    zh_TW: {
      "Site domain": "站點域名",
    },
  };
}