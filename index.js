import express from 'express';
import axios from 'axios';
import { load } from 'cheerio';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API statistics
let apiStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  anilistRequests: 0,
  lastUpdated: new Date().toISOString()
};

// AniList GraphQL API
const ANILIST_API = 'https://graphql.anilist.co';

// ==================== UPDATE PROVIDER LIST ====================
const PROVIDERS = [
  { 
    id: 'satoru', 
    name: 'Gojo', 
    baseUrl: 'https://satoru.one',
    priority: 1,
    enabled: true
  },
  { 
    id: 'watchanimeworld', 
    name: 'Geto', 
    baseUrl: 'https://watchanimeworld.in',
    priority: 2,
    enabled: true
  },
  { 
    id: 'toonstream', 
    name: 'Luffy', 
    baseUrl: 'https://toonstream.love',
    priority: 3,
    enabled: true
  },
  { 
    id: 'animeworldindia', 
    name: 'Yuji', 
    baseUrl: 'https://animeworld-india.me',
    priority: 4,
    enabled: true
  },
  { 
    id: 'animesalt', 
    name: 'AnimeSalt', 
    baseUrl: 'https://animesalt.cc',
    priority: 5,
    enabled: true
  }
];

// ==================== ADVANCED CACHE SYSTEM ====================
const searchCache = new Map();
const episodeCache = new Map();

function cacheKey(animeTitle, episode, provider = '') {
  return `${provider}:${animeTitle.toLowerCase().trim()}:${episode}`;
}

function setCache(key, data, ttl = 15 * 60 * 1000) {
  searchCache.set(key, {
    data,
    expiry: Date.now() + ttl
  });
}

function getCache(key) {
  const item = searchCache.get(key);
  if (item && item.expiry > Date.now()) {
    return item.data;
  }
  searchCache.delete(key);
  return null;
}

// ==================== ENHANCED HEADERS & UTILITIES ====================
function getEnhancedHeaders(referer = 'https://google.com') {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': referer,
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1'
  };
}

function detectServerType(urlOrName) {
  const text = (urlOrName || '').toLowerCase();
  if (text.includes('streamtape')) return 'StreamTape';
  if (text.includes('dood')) return 'DoodStream';
  if (text.includes('filemoon')) return 'FileMoon';
  if (text.includes('mp4upload')) return 'Mp4Upload';
  if (text.includes('vidstream')) return 'VidStream';
  if (text.includes('voe')) return 'Voe';
  if (text.includes('satoru')) return 'Gojo';
  if (text.includes('toonstream')) return 'Luffy';
  if (text.includes('animeworld-india')) return 'Yuji';
  if (text.includes('watchanimeworld')) return 'Geto';
  if (text.includes('animesalt')) return 'AnimeSalt';
  if (text.includes('m3u8')) return 'HLS';
  if (text.includes('mp4')) return 'MP4';
  return 'Direct';
}

function detectQualityFromUrl(url) {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('1080') || urlLower.includes('1920x1080')) return '1080p';
  if (urlLower.includes('720') || urlLower.includes('1280x720')) return '720p';
  if (urlLower.includes('480') || urlLower.includes('854x480')) return '480p';
  if (urlLower.includes('360') || urlLower.includes('640x360')) return '360p';
  if (urlLower.includes('hd')) return '720p';
  if (urlLower.includes('fullhd')) return '1080p';
  if (urlLower.includes('.m3u8')) return 'Adaptive';
  
  return 'Auto';
}

function isBlockedSource(url) {
  const blockedPatterns = [
    'youtube.com', 'youtu.be', 'facebook.com', 'twitter.com',
    'instagram.com', '/ads/', 'trailer', 'preview', 'promo',
    'analytics', 'tracking', 'google.com', 'doubleclick.net',
    'googleads', 'adsystem', 'adservice', 'popads.net',
    'banner', 'adserver', 'googlesyndication'
  ];
  
  return blockedPatterns.some(pattern => url.toLowerCase().includes(pattern));
}

function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  
  try {
    const base = new URL(baseUrl);
    return `${base.origin}${url.startsWith('/') ? url : '/' + url}`;
  } catch (e) {
    return url;
  }
}

function removeDuplicateServers(servers) {
  const seen = new Set();
  return servers.filter(server => {
    const normalizedUrl = server.url.split('?')[0].split('#')[0];
    const key = normalizedUrl + server.type;
    
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ==================== ANILIST INTEGRATION ====================
async function getAnimeTitleFromAniList(anilistId) {
  try {
    apiStats.anilistRequests++;
    
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          synonyms
        }
      }
    `;

    const response = await axios.post(ANILIST_API, {
      query,
      variables: { id: parseInt(anilistId) }
    }, { 
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (response.data.data?.Media) {
      const media = response.data.data.Media;
      const titles = [
        media.title.english,
        media.title.romaji, 
        media.title.native,
        ...(media.synonyms || [])
      ].filter(Boolean);
      
      return {
        primary: media.title.english || media.title.romaji,
        all: titles
      };
    }
    throw new Error('Anime not found on AniList');
  } catch (err) {
    console.error('AniList error:', err.message);
    throw new Error(`AniList: ${err.message}`);
  }
}

async function tryToonstream(animeTitle, episode, useCache = true) {
  const cacheKey = `toonstream:${animeTitle}:${episode}`;
  
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    console.log(`🔍 [Toonstream] Enhanced search: ${animeTitle} Episode ${episode}`);
    
    // Multiple search approaches
    const searchTerms = [
      animeTitle,
      animeTitle.toLowerCase(),
      animeTitle.replace(/[^\w\s]/g, ' ').trim(),
      animeTitle.replace(/season \d+/i, '').trim()
    ];

    let animeUrl = null;

    for (const searchTerm of searchTerms) {
      try {
        const searchUrl = `https://toonstream.love/?s=${encodeURIComponent(searchTerm)}`;
        console.log(`🔗 Search attempt: "${searchTerm}" -> ${searchUrl}`);
        
        const searchResponse = await axios.get(searchUrl, {
          headers: getEnhancedHeaders('https://toonstream.love'),
          timeout: 10000
        });

        const $ = load(searchResponse.data);
        
        // Multiple selector patterns
        const selectors = [
          '.film_list-wrap .film-detail',
          '.flw-item',
          '[href*="/series/"]',
          '.film-poster-ahref',
          '.movie-item'
        ];

        for (const selector of selectors) {
          $(selector).each((i, el) => {
            const name = $(el).find('.film-name, .dynamic-name, .film-title, h3, h4, .name').text().trim().toLowerCase();
            let url = $(el).attr('href');
            
            if (name && url && name.includes(animeTitle.toLowerCase())) {
              if (url && !url.startsWith('http')) {
                url = `https://toonstream.love${url.startsWith('/') ? url : '/' + url}`;
              }
              if (url && url.includes('/series/')) {
                animeUrl = url;
                console.log(`✅ Found match: "${$(el).find('.film-name, .dynamic-name').text().trim()}" -> ${animeUrl}`);
                return false;
              }
            }
          });
          if (animeUrl) break;
        }
        if (animeUrl) break;
      } catch (searchError) {
        console.log(`⚠️ Search term failed: ${searchError.message}`);
        continue;
      }
    }

    if (!animeUrl) {
      // Try direct URL construction as last resort
      const cleanSlug = animeTitle.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      
      const directUrl = `https://toonstream.love/series/${cleanSlug}/`;
      console.log(`🔄 Trying direct URL: ${directUrl}`);
      
      try {
        const directResponse = await axios.get(directUrl, {
          headers: getEnhancedHeaders('https://toonstream.love'),
          timeout: 5000,
          validateStatus: null
        });
        
        if (directResponse.status === 200) {
          animeUrl = directUrl;
          console.log(`✅ Direct URL worked: ${animeUrl}`);
        }
      } catch (directError) {
        console.log(`❌ Direct URL failed: ${directError.message}`);
      }
    }

    if (!animeUrl) throw new Error('Anime not found in search results');

    // Extract series slug and build episode URL
    const seriesMatch = animeUrl.match(/\/series\/([^\/]+)/);
    if (!seriesMatch) throw new Error('Could not extract series slug');
    
    const seriesSlug = seriesMatch[1].replace(/\/$/, '');
    console.log(`🎯 Series Slug: ${seriesSlug}`);

    // Try multiple episode URL formats
    const episodeUrlFormats = [
      `https://toonstream.love/episode/${seriesSlug}-1x${episode}/`,
      `https://toonstream.love/episode/${seriesSlug}-episode-${episode}/`,
      `https://toonstream.love/episode/${seriesSlug}-ep-${episode}/`
    ];

    let episodeData = null;

    for (const episodeUrl of episodeUrlFormats) {
      try {
        console.log(`🔗 Trying episode URL: ${episodeUrl}`);
        
        const episodeResponse = await axios.get(episodeUrl, {
          headers: getEnhancedHeaders(animeUrl),
          timeout: 8000,
          validateStatus: null
        });

        if (episodeResponse.status === 200) {
          const $$ = load(episodeResponse.data);
          
          // Check if page is valid (not 404)
          const pageTitle = $$('title').text();
          if (pageTitle.includes('404') || pageTitle.includes('Not Found')) {
            continue;
          }

          const servers = await extractEnhancedToonstreamServers($$, episodeUrl);
          if (servers.length > 0) {
            episodeData = {
              url: servers[0].url,
              servers: servers,
              source: 'toonstream.love',
              provider: 'toonstream',
              episode: episode,
              valid: true,
              cached: false
            };
            console.log(`✅ Found ${servers.length} servers on toonstream.love`);
            break;
          }
        }
      } catch (episodeError) {
        console.log(`⚠️ Episode URL failed: ${episodeError.message}`);
        continue;
      }
    }

    if (!episodeData) {
      throw new Error('No episode data found - episode may not exist on this provider');
    }

    setCache(cacheKey, episodeData);
    return episodeData;

  } catch (err) {
    console.error(`💥 toonstream.love error: ${err.message}`);
    throw err;
  }
}

// ==================== OTHER PROVIDER FUNCTIONS ====================
async function tryAnimeSalt(animeTitle, episode, useCache = true) {
  const cacheKey = `animesalt:${animeTitle}:${episode}`;
  
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    console.log(`🔍 [AnimeSalt] Searching: ${animeTitle} Episode ${episode}`);
    
    const searchUrl = `https://animesalt.cc/?s=${encodeURIComponent(animeTitle)}`;
    const searchResponse = await axios.get(searchUrl, {
      headers: getEnhancedHeaders('https://animesalt.cc'),
      timeout: 8000
    });

    const $ = load(searchResponse.data);
    
    let seriesUrl = null;
    let seriesSlug = null;

    $('a[href*="/series/"]').each((i, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();
      
      if (href && title.toLowerCase().includes(animeTitle.toLowerCase())) {
        seriesUrl = href;
        return false;
      }
    });

    if (!seriesUrl) {
      const cleanSlug = animeTitle.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, '-');
      seriesUrl = `https://animesalt.cc/series/${cleanSlug}/`;
    }

    const slugMatch = seriesUrl.match(/\/series\/([^\/]+)/);
    if (slugMatch) {
      seriesSlug = slugMatch[1];
    } else {
      throw new Error('Could not extract series slug');
    }

    const episodeUrl = `https://animesalt.cc/episode/${seriesSlug}-1x${episode}/`;
    
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getEnhancedHeaders(seriesUrl),
      timeout: 8000,
      validateStatus: null
    });

    if (episodeResponse.status !== 200) {
      throw new Error('Episode page not found');
    }

    const $$ = load(episodeResponse.data);
    const servers = extractAnimeSaltServers($$, episodeUrl);
    
    if (servers.length === 0) {
      throw new Error('No servers found on episode page');
    }

    const episodeData = {
      url: servers[0].url,
      servers: servers,
      source: 'animesalt.cc',
      provider: 'animesalt',
      episode: episode,
      valid: true,
      cached: false
    };

    setCache(cacheKey, episodeData);
    return episodeData;

  } catch (err) {
    console.error(`💥 animesalt.cc error: ${err.message}`);
    throw err;
  }
}

function extractAnimeSaltServers($, baseUrl) {
  const servers = [];
  
  $('.server, [class*="server"], [data-server]').each((i, el) => {
    const serverText = $(el).text().toLowerCase();
    let serverName = 'Server ' + (i + 1);
    
    if (serverText.includes('server 1') || serverText.includes('play')) {
      serverName = 'Server Play';
    } else if (serverText.includes('server 2') || serverText.includes('abyss')) {
      serverName = 'Server Abyss';
    }
    
    let iframeSrc = $(el).find('iframe').attr('src');
    if (!iframeSrc) {
      iframeSrc = $(el).attr('data-src') || $(el).attr('data-video') || $(el).find('a').attr('data-video');
    }
    
    if (iframeSrc) {
      const fullUrl = normalizeUrl(iframeSrc, baseUrl);
      if (fullUrl && !isBlockedSource(fullUrl)) {
        servers.push({
          name: serverName,
          url: fullUrl,
          type: 'iframe',
          server: detectServerType(fullUrl),
          quality: detectQualityFromUrl(fullUrl),
          priority: i
        });
      }
    }
  });

  $('iframe').each((i, el) => {
    let src = $(el).attr('src') || $(el).attr('data-src');
    if (src) {
      src = normalizeUrl(src, baseUrl);
      if (src && !isBlockedSource(src)) {
        servers.push({
          name: `Embed ${i + 1}`,
          url: src,
          type: 'iframe',
          server: detectServerType(src),
          quality: detectQualityFromUrl(src),
          priority: 10 + i
        });
      }
    }
  });

  const scriptContent = $('script').text();
  const videoPatterns = [
    /(https?:[^"']*\.m3u8[^"']*)/gi,
    /(https?:[^"']*\.mp4[^"']*)/gi,
    /file:\s*["'](https?:[^"']*)["']/gi,
    /src:\s*["'](https?:[^"']*)["']/gi,
    /videoUrl:\s*["'](https?:[^"']*)["']/gi
  ];

  videoPatterns.forEach(pattern => {
    const matches = scriptContent.match(pattern);
    if (matches) {
      matches.forEach((url, i) => {
        const cleanUrl = url.replace(/['"]/g, '')
          .replace(/file:\s*/, '')
          .replace(/src:\s*/, '')
          .replace(/videoUrl:\s*/, '')
          .trim();
        
        if (cleanUrl.includes('http') && !isBlockedSource(cleanUrl)) {
          servers.push({
            name: `Direct Stream ${servers.length + 1}`,
            url: cleanUrl,
            type: 'direct',
            server: 'JavaScript',
            quality: detectQualityFromUrl(cleanUrl),
            priority: 20 + i
          });
        }
      });
    }
  });

  const uniqueServers = removeDuplicateServers(servers);
  uniqueServers.sort((a, b) => a.priority - b.priority);
  
  return uniqueServers;
}

async function tryAnimeWorldIndia(animeTitle, episode, useCache = true) {
  const cacheKey = `animeworldindia:${animeTitle}:${episode}`;
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    const cleanTitle = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    const episodeUrl = `https://animeworld-india.me/episode/${cleanTitle}-1x${episode}`;
    
    const response = await axios.get(episodeUrl, {
      headers: getEnhancedHeaders(),
      timeout: 8000,
      validateStatus: null
    });

    if (response.status !== 200) throw new Error('Episode page not found');

    const $ = load(response.data);
    const servers = extractServersDirectly($, episodeUrl);
    
    if (servers.length === 0) {
      throw new Error('No servers found on episode page');
    }

    const result = {
      url: servers[0].url,
      servers: servers,
      source: 'animeworld-india.me',
      provider: 'animeworldindia',
      episode: episode,
      valid: true,
      cached: false
    };

    setCache(cacheKey, result);
    return result;

  } catch (err) {
    console.error(`💥 animeworld-india.me error: ${err.message}`);
    throw err;
  }
}

async function tryWatchAnimeWorld(animeTitle, episode, useCache = true) {
  const cacheKey = `watchanimeworld:${animeTitle}:${episode}`;
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    const cleanTitle = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    const url = `https://watchanimeworld.in/episode/${cleanTitle}-1x${episode}`;
    
    const response = await axios.get(url, {
      headers: getEnhancedHeaders(),
      timeout: 8000,
      validateStatus: null
    });

    if (response.status === 200 && !response.data.includes('404')) {
      const $ = load(response.data);
      const servers = extractServersDirectly($, 'https://watchanimeworld.in');
      
      if (servers.length > 0) {
        const result = {
          url: servers[0].url,
          servers: servers,
          source: 'watchanimeworld.in',
          provider: 'watchanimeworld',
          season: 1,
          episode: episode,
          valid: true,
          cached: false
        };

        setCache(cacheKey, result);
        return result;
      }
    }
    
    throw new Error('Not found');
  } catch (err) {
    console.error(`💥 watchanimeworld.in error: ${err.message}`);
    throw err;
  }
}

async function trySatoru(animeTitle, episode, useCache = true) {
  const cacheKey = `satoru:${animeTitle}:${episode}`;
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    const cleanTitle = animeTitle.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = `https://satoru.one/filter?keyword=${encodeURIComponent(cleanTitle)}`;
    
    const searchResponse = await axios.get(searchUrl, {
      headers: getEnhancedHeaders('https://satoru.one'),
      timeout: 10000
    });

    const $ = load(searchResponse.data);
    
    let animeId = null;
    
    $('.flw-item, .film_list-wrap .flw-item, .movie-item').each((i, el) => {
      const name = $(el).find('.film-name, .dynamic-name, .film-title, h3, h4').text().trim();
      const dataId = $(el).find('.film-poster-ahref, [data-id]').attr('data-id') || 
                    $(el).find('a').attr('href')?.match(/\/movie\/([^\/]+)/)?.[1];
      
      if (name && dataId && name.toLowerCase().includes(cleanTitle.toLowerCase())) {
        animeId = dataId;
        return false;
      }
    });

    if (!animeId) throw new Error('Anime not found in search results');

    const episodeUrl = `https://satoru.one/ajax/episode/list/${animeId}`;
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getEnhancedHeaders('https://satoru.one'),
      timeout: 10000
    });

    if (!episodeResponse.data || !episodeResponse.data.html) {
      throw new Error('No episode list returned from server');
    }

    const $$ = load(episodeResponse.data.html);
    
    let episodeId = null;
    
    $$('.ep-item, .episode-item, [data-number]').each((i, el) => {
      const epNumber = $$(el).attr('data-number') || $$(el).find('.episode-number').text().trim();
      const id = $$(el).attr('data-id') || $$(el).attr('id')?.replace('episode-', '');
      
      if (epNumber && id && parseInt(epNumber) === parseInt(episode)) {
        episodeId = id;
        return false;
      }
    });

    if (!episodeId) throw new Error(`Episode ${episode} not found in episode list`);

    const serversUrl = `https://satoru.one/ajax/episode/servers?episodeId=${episodeId}`;
    const serversResponse = await axios.get(serversUrl, {
      headers: getEnhancedHeaders('https://satoru.one'),
      timeout: 10000
    });

    if (!serversResponse.data || !serversResponse.data.html) {
      throw new Error('No servers list returned');
    }

    const $$$ = load(serversResponse.data.html);
    
    const allServers = [];
    $$$('.server-item, .server-btn, [data-server]').each((i, el) => {
      const serverId = $$$(el).attr('data-id') || $$$(el).attr('data-server');
      const serverName = $$$(el).text().trim() || `Server ${i + 1}`;
      
      if (serverId) {
        allServers.push({
          id: serverId,
          name: serverName,
          type: detectServerType(serverName)
        });
      }
    });

    if (allServers.length === 0) {
      throw new Error('No servers available for this episode');
    }

    const serverPromises = allServers.map(async (server, index) => {
      try {
        const sourceUrl = `https://satoru.one/ajax/episode/sources?id=${server.id}`;
        const sourceResponse = await axios.get(sourceUrl, {
          headers: getEnhancedHeaders('https://satoru.one'),
          timeout: 8000
        });

        if (sourceResponse.data && sourceResponse.data.link) {
          let iframeUrl = sourceResponse.data.link;
          
          if (iframeUrl.toLowerCase().includes('youtube') || 
              iframeUrl.toLowerCase().includes('youtu.be') ||
              isBlockedSource(iframeUrl)) {
            return null;
          }

          iframeUrl = normalizeUrl(iframeUrl, 'https://satoru.one');
          
          return {
            name: server.name,
            url: iframeUrl,
            type: 'iframe',
            server: server.type,
            quality: detectQualityFromUrl(iframeUrl),
            priority: index
          };
        }
      } catch (error) {
        return null;
      }
    });

    const serverResults = await Promise.allSettled(serverPromises);
    const validServers = serverResults
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value);

    if (validServers.length === 0) {
      throw new Error('No working video servers found');
    }

    const result = {
      url: validServers[0].url,
      servers: validServers,
      source: 'satoru.one',
      provider: 'satoru',
      episode: parseInt(episode),
      valid: true,
      cached: false
    };

    setCache(cacheKey, result);
    return result;

  } catch (err) {
    console.error(`💥 satoru.one error: ${err.message}`);
    throw err;
  }
}

function extractServersDirectly($$, baseUrl) {
  const servers = [];
  
  $$('iframe').each((i, el) => {
    let src = $$(el).attr('src') || $$(el).attr('data-src') || $$(el).attr('data-lazy-src');
    if (src) {
      src = normalizeUrl(src, baseUrl);
      if (src && src.startsWith('http') && !isBlockedSource(src)) {
        servers.push({
          name: `Embed ${i + 1}`,
          url: src,
          type: 'iframe',
          server: detectServerType(src),
          quality: detectQualityFromUrl(src)
        });
      }
    }
  });

  $$('video source, video[src]').each((i, el) => {
    let src = $$(el).attr('src');
    if (src) {
      src = normalizeUrl(src, baseUrl);
      if (src && src.startsWith('http') && !isBlockedSource(src)) {
        servers.push({
          name: `Direct Video ${i + 1}`,
          url: src,
          type: 'direct',
          server: 'Direct',
          quality: detectQualityFromUrl(src)
        });
      }
    }
  });

  const scriptContent = $$('script').text();
  const videoPatterns = [
    /(https?:[^"']*\.m3u8[^"']*)/gi,
    /(https?:[^"']*\.mp4[^"']*)/gi,
    /file:\s*["'](https?:[^"']*)["']/gi,
    /src:\s*["'](https?:[^"']*)["']/gi,
    /videoUrl:\s*["'](https?:[^"']*)["']/gi
  ];

  videoPatterns.forEach(pattern => {
    const matches = scriptContent.match(pattern);
    if (matches) {
      matches.forEach((url, i) => {
        const cleanUrl = url.replace(/['"]/g, '')
          .replace(/file:\s*/, '')
          .replace(/src:\s*/, '')
          .replace(/videoUrl:\s*/, '')
          .trim();
        
        if (cleanUrl.includes('http') && !isBlockedSource(cleanUrl)) {
          servers.push({
            name: `JavaScript Source ${servers.length + 1}`,
            url: cleanUrl,
            type: 'direct',
            server: 'JavaScript',
            quality: detectQualityFromUrl(cleanUrl)
          });
        }
      });
    }
  });

  const uniqueServers = removeDuplicateServers(servers);
  return uniqueServers;
}

// ==================== IMPROVED MAIN SEARCH FUNCTION ====================
async function findEpisode(animeTitle, episode, provider = null, useCache = true) {
  console.log(`\n🎯 ENHANCED SEARCH STARTED: "${animeTitle}" Episode ${episode}`);
  
  const searchStartTime = Date.now();
  
  let sources = [
    { 
      name: 'satoru.one (Gojo)', 
      func: trySatoru, 
      id: 'satoru',
      timeout: 15000,
      priority: 1
    },
    { 
      name: 'watchanimeworld.in (Geto)', 
      func: tryWatchAnimeWorld, 
      id: 'watchanimeworld',
      timeout: 10000,
      priority: 2
    },
    { 
      name: 'toonstream.love (Luffy)', 
      func: tryToonstream, 
      id: 'toonstream',
      timeout: 15000,
      priority: 3
    },
    { 
      name: 'animeworld-india.me (Yuji)', 
      func: tryAnimeWorldIndia, 
      id: 'animeworldindia',
      timeout: 15000,
      priority: 4
    },
    { 
      name: 'animesalt.cc (AnimeSalt)', 
      func: tryAnimeSalt, 
      id: 'animesalt',
      timeout: 15000,
      priority: 5
    }
  ];
  
  sources.sort((a, b) => a.priority - b.priority);
  
  // If specific provider is requested, try it first but fallback to others
  let preferredProvider = null;
  if (provider) {
    preferredProvider = sources.find(s => s.id === provider);
    if (!preferredProvider) {
      throw new Error(`Provider ${provider} not found. Available providers: ${sources.map(s => s.id).join(', ')}`);
    }
    console.log(`🎯 Using preferred provider: ${preferredProvider.name}`);
    // Move preferred provider to front
    sources = [preferredProvider, ...sources.filter(s => s.id !== provider)];
  }
  
  const errors = [];
  
  for (const source of sources) {
    // Skip if we already found a result from preferred provider
    if (preferredProvider && source.id !== preferredProvider.id && errors.length === 0) {
      continue;
    }
    
    try {
      console.log(`\n🔍 [${source.name}] Searching...`);
      
      const result = await Promise.race([
        source.func(animeTitle, episode, useCache),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${source.timeout}ms`)), source.timeout)
        )
      ]);
      
      if (result && result.valid) {
        const searchTime = Date.now() - searchStartTime;
        console.log(`✅ SUCCESS: Found on ${source.name} in ${searchTime}ms`);
        
        result.searchTime = searchTime;
        result.totalProviders = sources.length;
        result.triedProviders = sources.indexOf(source) + 1;
        result.cached = !!result.cached;
        
        return result;
      }
    } catch (error) {
      const errorMsg = `${source.name}: ${error.message}`;
      console.log(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      // If preferred provider fails, continue to other providers
      if (preferredProvider && source.id === preferredProvider.id) {
        console.log(`🔄 Preferred provider failed, trying others...`);
        continue;
      }
    }
  }
  
  const totalTime = Date.now() - searchStartTime;
  console.log(`💥 All providers failed in ${totalTime}ms`);
  
  throw new Error(`Episode ${episode} of "${animeTitle}" not found on any source. Errors: ${errors.join('; ')}`);
}

// ==================== BOSS LEVEL ADBLOCKER INTEGRATION ====================
function getBossLevelAdBlockerScript() {
  return `
    (function() {
        'use strict';
        
        console.log('🎯 BOSS LEVEL AdBlocker activated - Video Focused');
        
        let isBlocking = true;
        let stats = {
            totalBlocks: 0,
            videoAds: 0
        };

        // Load stats from localStorage
        try {
            const savedStats = localStorage.getItem('bossLevelAdblockerStats');
            if (savedStats) {
                stats = JSON.parse(savedStats);
            }
        } catch (e) {
            console.log('❌ Could not load saved stats');
        }

        // BOSS LEVEL: Target specific video ad patterns
        const VIDEO_AD_SELECTORS = [
            'video[src*="ad"]',
            'video[src*="banner"]',
            'video[src*="promo"]',
            'video[src*="commercial"]',
            'video[src*="ads"]',
            'video.jw-video.jw-reset',
            'video[class*="ad"]',
            'video[id*="ad"]',
            'video[data-ad]',
            '.ad-video',
            '.video-ad',
            '.ad-container video',
            '.ad-unit video',
            '.adsbygoogle video'
        ];

        // Ad domains to block
        const AD_DOMAINS = [
            'doubleclick.net',
            'googleadservices.com',
            'googlesyndication.com',
            'adsystem',
            'advertising.com',
            'ads.',
            'banner',
            'sponsor',
            'promo',
            'tracking'
        ];

        // Initialize the adblocker
        function init() {
            console.log('🛡️ BOSS LEVEL AdBlocker initializing...');
            
            // Start aggressive ad blocking
            startVideoAdBlocking();
            blockAdIframes();
            blockAdScripts();
            setupObservers();
            setupEventListeners();
            
            console.log('✅ BOSS LEVEL AdBlocker ready - Monitoring for ads');
        }

        function startVideoAdBlocking() {
            // Block existing video ads
            VIDEO_AD_SELECTORS.forEach(selector => {
                try {
                    const videos = document.querySelectorAll(selector);
                    videos.forEach(video => {
                        if (isVideoAd(video)) {
                            blockVideoAd(video);
                        }
                    });
                } catch (e) {
                    console.log('❌ Error with selector:', selector, e);
                }
            });

            // Monitor all videos for ad behavior
            const allVideos = document.querySelectorAll('video');
            allVideos.forEach(video => {
                monitorVideoForAds(video);
            });
        }

        function isVideoAd(video) {
            if (!video || !video.src) return false;
            
            const src = video.src.toLowerCase();
            const className = video.className.toLowerCase();
            const id = video.id.toLowerCase();
            
            // Check for ad indicators
            const isAd = (
                AD_DOMAINS.some(domain => src.includes(domain)) ||
                src.includes('ad') ||
                src.includes('banner') ||
                src.includes('promo') ||
                className.includes('ad') ||
                id.includes('ad') ||
                video.hasAttribute('data-ad') ||
                video.duration < 120 // Short videos might be ads
            );
            
            return isAd;
        }

        function blockVideoAd(video) {
            if (video.classList.contains('boss-adblocker-handled')) return;
            
            console.log('🚫 Blocking video ad:', video.src);
            
            video.classList.add('boss-adblocker-handled');
            
            // Try to skip the ad by seeking to end
            try {
                if (video.duration > 0) {
                    video.currentTime = video.duration - 1;
                    video.pause();
                }
            } catch (e) {
                // If we can't control it, remove it
                video.remove();
            }
            
            // Remove video from DOM if it's definitely an ad
            if (isDefiniteAd(video)) {
                setTimeout(() => {
                    if (video.parentNode) {
                        video.remove();
                        console.log('🗑️ Removed video ad from DOM');
                    }
                }, 1000);
            }
            
            // Update stats
            stats.totalBlocks++;
            stats.videoAds++;
            saveStats();
        }

        function isDefiniteAd(video) {
            const src = video.src.toLowerCase();
            return (
                src.includes('doubleclick') ||
                src.includes('googleadservices') ||
                src.includes('googlesyndication') ||
                video.duration < 60 // Very short videos are likely ads
            );
        }

        function monitorVideoForAds(video) {
            if (video.classList.contains('boss-adblocker-monitored')) return;
            
            video.classList.add('boss-adblocker-monitored');
            
            let lastSrc = video.src;
            let adCheckInterval;
            
            const checkForAd = () => {
                if (!isBlocking) return;
                
                const currentSrc = video.src;
                
                // Check if source changed to an ad
                if (currentSrc !== lastSrc) {
                    lastSrc = currentSrc;
                    if (isVideoAd(video)) {
                        blockVideoAd(video);
                        return;
                    }
                }
                
                // Check for short videos (potential ads)
                if (video.duration > 0 && video.duration < 120) {
                    console.log('⏱️ Short video detected (potential ad):', video.duration, 'seconds');
                    if (isVideoAd(video)) {
                        blockVideoAd(video);
                    }
                }
                
                // Check if video is playing but very short (likely ad)
                if (!video.paused && video.duration < 30) {
                    console.log('🎬 Short playing video detected - likely ad');
                    blockVideoAd(video);
                }
            };
            
            // Start monitoring
            adCheckInterval = setInterval(checkForAd, 2000);
            
            // Monitor video events
            const events = ['loadstart', 'canplay', 'timeupdate', 'play', 'playing'];
            events.forEach(event => {
                video.addEventListener(event, checkForAd);
            });
            
            // Clean up when video is removed
            const observer = new MutationObserver(() => {
                if (!document.contains(video)) {
                    clearInterval(adCheckInterval);
                    observer.disconnect();
                    events.forEach(event => {
                        video.removeEventListener(event, checkForAd);
                    });
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        function blockAdIframes() {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                try {
                    const src = iframe.src || '';
                    if (isAdUrl(src)) {
                        console.log('🚫 Blocking ad iframe:', src);
                        iframe.remove();
                        stats.totalBlocks++;
                        saveStats();
                    }
                } catch (e) {
                    // Cross-origin error, remove anyway
                    iframe.remove();
                }
            });
        }

        function blockAdScripts() {
            const scripts = document.querySelectorAll('script');
            scripts.forEach(script => {
                const src = script.src || '';
                if (isAdUrl(src)) {
                    console.log('🚫 Blocking ad script:', src);
                    script.remove();
                    stats.totalBlocks++;
                    saveStats();
                }
            });
        }

        function isAdUrl(url) {
            if (!url) return false;
            url = url.toLowerCase();
            return AD_DOMAINS.some(domain => url.includes(domain));
        }

        function setupObservers() {
            // Observe for new elements added to DOM
            const observer = new MutationObserver((mutations) => {
                if (!isBlocking) return;
                
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) {
                            // Check videos
                            if (node.tagName === 'VIDEO') {
                                setTimeout(() => {
                                    if (isVideoAd(node)) {
                                        blockVideoAd(node);
                                    } else {
                                        monitorVideoForAds(node);
                                    }
                                }, 100);
                            }
                            
                            // Check iframes
                            if (node.tagName === 'IFRAME') {
                                const src = node.src || '';
                                if (isAdUrl(src)) {
                                    node.remove();
                                    stats.totalBlocks++;
                                    saveStats();
                                }
                            }
                            
                            // Check scripts
                            if (node.tagName === 'SCRIPT') {
                                const src = node.src || '';
                                if (isAdUrl(src)) {
                                    node.remove();
                                    stats.totalBlocks++;
                                    saveStats();
                                }
                            }
                            
                            // Check nested elements
                            if (node.querySelectorAll) {
                                // Videos
                                node.querySelectorAll('video').forEach(video => {
                                    setTimeout(() => {
                                        if (isVideoAd(video)) {
                                            blockVideoAd(video);
                                        } else {
                                            monitorVideoForAds(video);
                                        }
                                    }, 100);
                                });
                                
                                // Iframes
                                node.querySelectorAll('iframe').forEach(iframe => {
                                    const src = iframe.src || '';
                                    if (isAdUrl(src)) {
                                        iframe.remove();
                                        stats.totalBlocks++;
                                        saveStats();
                                    }
                                });
                            }
                        }
                    });
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        function setupEventListeners() {
            // Listen for messages (if you want to add controls later)
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'BOSS_ADBLOCKER_TOGGLE') {
                    isBlocking = event.data.enabled;
                    console.log(isBlocking ? '✅ AdBlocker enabled' : '⏸️ AdBlocker paused');
                }
            });
            
            // Expose controls to window for debugging
            window.bossAdblocker = {
                toggle: (enabled) => {
                    isBlocking = enabled;
                    return isBlocking;
                },
                getStats: () => stats,
                forceBlock: () => {
                    startVideoAdBlocking();
                    blockAdIframes();
                    blockAdScripts();
                },
                debug: () => {
                    const allVideos = document.querySelectorAll('video');
                    const monitored = document.querySelectorAll('.boss-adblocker-monitored');
                    const blocked = document.querySelectorAll('.boss-adblocker-handled');
                    
                    console.log('=== BOSS LEVEL ADBLOCKER DEBUG ===');
                    console.log('Blocking:', isBlocking);
                    console.log('Total videos:', allVideos.length);
                    console.log('Monitored videos:', monitored.length);
                    console.log('Blocked videos:', blocked.length);
                    console.log('Total blocks:', stats.totalBlocks);
                    console.log('Video ads blocked:', stats.videoAds);
                    
                    allVideos.forEach((video, index) => {
                        console.log(\`Video \${index + 1}:\`, {
                            src: video.src ? video.src.substring(0, 50) + '...' : 'no-src',
                            duration: video.duration,
                            class: video.className,
                            monitored: video.classList.contains('boss-adblocker-monitored'),
                            blocked: video.classList.contains('boss-adblocker-handled')
                        });
                    });
                }
            };
        }

        function saveStats() {
            try {
                localStorage.setItem('bossLevelAdblockerStats', JSON.stringify(stats));
            } catch (e) {
                console.log('❌ Could not save stats');
            }
        }

        // Auto-skip ads in iframes (for embedded players)
        function setupIframeAdSkipping() {
            setInterval(() => {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach(iframe => {
                    try {
                        // Try to skip ads in iframes by sending skip commands
                        iframe.contentWindow?.postMessage({
                            type: 'SKIP_AD',
                            timestamp: Date.now()
                        }, '*');
                    } catch (e) {
                        // Cross-origin error, ignore
                    }
                });
            }, 3000);
        }

        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        
        // Also start iframe ad skipping
        setTimeout(setupIframeAdSkipping, 5000);

        console.log('🎯 BOSS LEVEL AdBlocker loaded successfully');

    })();
    `;
}

// ==================== ENHANCED PLAYER WITH BOSS LEVEL AD BLOCKING ====================
function sendEnhancedPlayer(res, title, episode, videoUrl, servers = [], currentProvider = 'unknown', anilistId = null) {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Episode ${episode}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body, html {
            overflow: hidden;
            background: #000;
            width: 100vw;
            height: 100vh;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        /* Loading Screen */
        .loading-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
        }
        
        .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-top: 3px solid #fff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .loading-text {
            font-size: 1.2rem;
            color: #fff;
        }
        
        /* Player Container */
        .player-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
        }
        
        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        }
        
        /* Control buttons */
        .control-buttons {
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 999;
        }
        
        .control-btn {
            background: rgba(0,0,0,0.8);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 8px 12px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            backdrop-filter: blur(10px);
            transition: all 0.2s ease;
        }
        
        .control-btn:hover {
            background: rgba(0,0,0,0.9);
            border-color: #4ecdc4;
        }
        
        /* Server overlay */
        .server-overlay {
            position: fixed;
            top: 60px;
            right: 20px;
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 15px;
            border-radius: 10px;
            z-index: 1000;
            border: 1px solid rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
            max-width: 300px;
            display: none;
        }
        
        .server-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .server-title {
            font-weight: bold;
            color: #4ecdc4;
        }
        
        .server-list {
            max-height: 200px;
            overflow-y: auto;
        }
        
        .server-item {
            padding: 8px 12px;
            margin: 5px 0;
            background: rgba(255,255,255,0.1);
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }
        
        .server-item:hover {
            background: rgba(255,255,255,0.2);
            border-color: #4ecdc4;
        }
        
        .server-item.active {
            background: rgba(78, 205, 196, 0.3);
            border-color: #4ecdc4;
        }
        
        .server-name {
            font-weight: 500;
        }
        
        .server-type {
            font-size: 0.8em;
            opacity: 0.7;
            margin-top: 2px;
        }
        
        .source-info {
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 5px;
            z-index: 999;
            font-size: 12px;
            border: 1px solid rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
        }
        
        .hidden {
            display: none !important;
        }
        
        .loading-provider {
            color: #ff6b6b;
            font-size: 0.9rem;
            margin-top: 10px;
        }

        /* Ad-block notification */
        .ad-block-notice {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0,0,0,0.9);
            color: #4ecdc4;
            padding: 8px 12px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 999;
            border: 1px solid #4ecdc4;
            backdrop-filter: blur(10px);
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        /* Styles for blocked elements */
        .boss-adblocker-handled {
            opacity: 0.3 !important;
            pointer-events: none !important;
        }
    </style>
</head>
<body>
    <!-- Loading Screen -->
    <div class="loading-screen" id="loadingScreen">
        <div class="spinner"></div>
        <div class="loading-text">Loading Video Player...</div>
        <div class="loading-provider" id="loadingProvider">Provider: ${PROVIDERS.find(p => p.id === currentProvider)?.name || 'Auto'}</div>
    </div>

    <!-- Player Container -->
    <div class="player-container hidden" id="playerContainer">
        <div class="source-info">
            ${title} | Episode ${episode}
        </div>
        
        <div class="control-buttons">
            <button class="control-btn" onclick="toggleServerOverlay()">
                🔄 Servers (${servers.length})
            </button>
            <button class="control-btn" onclick="toggleFullscreen()">
                ⛶ Fullscreen
            </button>
        </div>
        
        <!-- Server Overlay -->
        <div class="server-overlay" id="serverOverlay">
            <div class="server-header">
                <div class="server-title">Available Servers</div>
                <button class="close-btn" onclick="toggleServerOverlay()">×</button>
            </div>
            <div class="server-list" id="serverList">
                ${servers.map((server, index) => `
                    <div class="server-item ${index === 0 ? 'active' : ''}" 
                         onclick="switchServer('${server.url}', '${server.type}', this)">
                        <div class="server-name">${server.name}</div>
                        <div class="server-type">${server.server} • ${server.quality}</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Ad-block notification -->
        <div class="ad-block-notice" id="adBlockNotice">
            🛡️ BOSS LEVEL Ad Blocker Active - Video Safe Mode
        </div>

        <iframe 
            id="videoFrame"
            src="${videoUrl}" 
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture" 
            allowfullscreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            loading="eager"
            referrerpolicy="no-referrer-when-downgrade"
            onload="hideLoadingScreen()">
        </iframe>
    </div>

    <script>
        ${getBossLevelAdBlockerScript()}

        // ==================== PLAYER FUNCTIONALITY ====================
        const loadingScreen = document.getElementById('loadingScreen');
        const playerContainer = document.getElementById('playerContainer');
        let currentServer = '${videoUrl}';
        let currentServerType = 'iframe';
        
        function hideLoadingScreen() {
            console.log('✅ Video frame loaded');
            loadingScreen.classList.add('hidden');
            playerContainer.classList.remove('hidden');
        }
        
        // Fallback in case loading stalls
        setTimeout(() => {
            if (!loadingScreen.classList.contains('hidden')) {
                console.log('🔄 Force showing player');
                loadingScreen.classList.add('hidden');
                playerContainer.classList.remove('hidden');
            }
        }, 8000);
        
        function toggleServerOverlay() {
            const overlay = document.getElementById('serverOverlay');
            overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
        }
        
        function switchServer(url, type, element) {
            if (url === currentServer) return;
            
            console.log('🔄 Switching to server:', url);
            loadingScreen.classList.remove('hidden');
            playerContainer.classList.add('hidden');
            
            // Update active server UI
            document.querySelectorAll('.server-item').forEach(item => {
                item.classList.remove('active');
            });
            element.classList.add('active');
            
            // Update iframe source
            const videoFrame = document.getElementById('videoFrame');
            currentServer = url;
            currentServerType = type;
            
            videoFrame.src = url;
            toggleServerOverlay();
        }
        
        function toggleFullscreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log('Fullscreen error:', err);
                });
            } else {
                document.exitFullscreen();
            }
        }
        
        // Auto-hide overlays
        setTimeout(() => {
            const overlay = document.getElementById('serverOverlay');
            if (overlay.style.display !== 'none') {
                overlay.style.display = 'none';
            }
        }, 6000);
        
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            if (e.key === 's' || e.key === 'S') toggleServerOverlay();
            if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            if (e.key === 'Escape') {
                document.getElementById('serverOverlay').style.display = 'none';
            }
        });
        
        // Click outside to close overlay
        document.addEventListener('click', (e) => {
            const overlay = document.getElementById('serverOverlay');
            if (!overlay.contains(e.target) && !e.target.classList.contains('control-btn')) {
                overlay.style.display = 'none';
            }
        });
    </script>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(html);
}

// ==================== MAIN ENDPOINT ====================
app.get('/api/anime/:anilistId/:episode', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { anilistId, episode } = req.params;
    const { json, provider } = req.query;

    console.log(`\n🎯 NEW REQUEST: ID ${anilistId} Episode ${episode}${provider ? ` [Provider: ${provider}]` : ''}`);
    apiStats.totalRequests++;

    // STEP 1: Get anime title from AniList
    console.log(`📝 STEP 1: Getting title from AniList...`);
    const titleData = await getAnimeTitleFromAniList(anilistId);
    console.log(`✅ Title: "${titleData.primary}"`);

    // STEP 2: Search for episode across sources
    console.log(`🔍 STEP 2: Searching for episode ${episode}...`);
    const episodeData = await findEpisode(titleData.primary, parseInt(episode), provider);

    if (!episodeData) {
      apiStats.failedRequests++;
      const responseTime = Date.now() - startTime;
      return res.status(404).json({ error: 'Episode not found' });
    }

    apiStats.successfulRequests++;
    const responseTime = Date.now() - startTime;
    console.log(`✅ SUCCESS: Found in ${responseTime}ms on ${episodeData.source}`);

    if (json) {
      return res.json({
        success: true,
        anilist_id: parseInt(anilistId),
        title: titleData.primary,
        episode: parseInt(episode),
        source: episodeData.source,
        provider: episodeData.provider,
        servers: episodeData.servers,
        total_servers: episodeData.servers.length,
        response_time: `${responseTime}ms`,
        search_time: episodeData.searchTime,
        cached: episodeData.cached || false
      });
    }

    // Send enhanced player with BOSS LEVEL ad blocking
    return sendEnhancedPlayer(res, titleData.primary, episode, 
                            episodeData.url, episodeData.servers, 
                            episodeData.provider, anilistId);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('💥 Error:', error.message);
    apiStats.failedRequests++;
    
    if (req.query.json) {
      return res.status(500).json({ error: error.message });
    }
    
    // Send error page
    const errorHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body { 
            background: #000; 
            color: white; 
            font-family: Arial, sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
        }
        .error-container { 
            text-align: center; 
            padding: 20px; 
        }
        .error-message { 
            color: #ff6b6b; 
            margin: 20px 0; 
        }
        .retry-btn { 
            background: #4ecdc4; 
            color: white; 
            border: none; 
            padding: 10px 20px; 
            border-radius: 5px; 
            cursor: pointer; 
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>❌ Error Loading Episode</h1>
        <div class="error-message">${error.message}</div>
        <button class="retry-btn" onclick="window.location.reload()">Retry</button>
        <button class="retry-btn" onclick="window.history.back()" style="background: #666; margin-left: 10px;">Go Back</button>
    </div>
</body>
</html>`;
    res.send(errorHtml);
  }
});

// ==================== CACHE MANAGEMENT ENDPOINTS ====================
app.post('/clear-cache', (req, res) => {
  const { key } = req.body;
  if (key && searchCache.has(key)) {
    searchCache.delete(key);
    res.json({ success: true, message: `Cache cleared for key: ${key}` });
  } else {
    res.json({ success: false, message: 'Cache key not found' });
  }
});

app.post('/clear-all-cache', (req, res) => {
  const previousSize = searchCache.size;
  searchCache.clear();
  res.json({ 
    success: true, 
    message: `Cleared all cache (${previousSize} items)` 
  });
});

app.get('/cache-stats', (req, res) => {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;
  
  searchCache.forEach((value, key) => {
    if (value.expiry > now) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  });
  
  res.json({
    total: searchCache.size,
    valid: validEntries,
    expired: expiredEntries,
    hitRate: 'N/A'
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'active',
    total_requests: apiStats.totalRequests,
    successful_requests: apiStats.successfulRequests,
    failed_requests: apiStats.failedRequests,
    success_rate: apiStats.totalRequests > 0 ? 
      Math.round((apiStats.successfulRequests / apiStats.totalRequests) * 100) + '%' : '0%',
    providers: PROVIDERS.map(p => ({ id: p.id, name: p.name, enabled: p.enabled })),
    cache_size: searchCache.size,
    uptime: process.uptime().toFixed(2) + 's'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🎯 ULTIMATE ANIME STREAMING API - BOSS LEVEL AD BLOCKING
─────────────────────────────────────────────────────
Port: ${PORT}
API: http://localhost:${PORT}

🔄 ENHANCED PROVIDERS:
• Gojo (satoru.one) - Priority 1
• Geto (watchanimeworld.in) - Priority 2  
• Luffy (toonstream.love) - Priority 3
• Yuji (animeworld-india.me) - Priority 4
• AnimeSalt (animesalt.cc) - Priority 5

🛡️ BOSS LEVEL AD BLOCKING:
• Advanced video ad detection
• Auto-skip video ads
• Block ad iframes & scripts
• Real-time DOM monitoring
• Video-focused protection
• Stats tracking

🎮 CONTROLS:
• Press 'S' - Switch servers
• Press 'F' - Toggle fullscreen
• Press 'ESC' - Close overlays

⚡ PERFORMANCE:
• Smart caching system
• Multi-provider fallback
• Fast timeouts
• Memory optimized

✅ READY: Ad-free streaming with BOSS LEVEL protection!
─────────────────────────────────────────────────────
  `);
});
