import express from 'express';
import axios from 'axios';
import { load } from 'cheerio';
import cors from 'cors';

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: ['https://affgdgh.vercel.app', 'http://localhost:3000', 'https://yourdomain.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
}));

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

// ==================== PROVIDER LIST ====================
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

// ==================== CACHE SYSTEM ====================
const searchCache = new Map();

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

// ==================== NUCLEAR AD BLOCKER ====================
function getNuclearAdBlockerScript() {
  return `
    (function() {
        'use strict';
        
        console.log('💥 NUCLEAR AD BLOCKER ACTIVATED - NO ADS WILL SURVIVE');
        
        let nukesLaunched = 0;
        let adsDestroyed = 0;
        
        // COMPLETE AD DOMAIN BLACKLIST
        const AD_DOMAINS = [
            'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
            'google-analytics.com', 'googletagservices.com', 'gstatic.com',
            'facebook.com/tr', 'connect.facebook.net', 'facebook.net',
            'twitter.com/i/ads', 'adsystem', 'adservice', 'adnxs.com',
            'ads.', 'tracking', 'analytics', 'banner', 'popup', 'promo'
        ];

        // NUCLEAR SELECTORS - EVERY POSSIBLE AD ELEMENT
        const NUCLEAR_SELECTORS = [
            '[class*="ad"]', '[id*="ad"]', '[class*="ads"]', '[id*="ads"]',
            '[class*="banner"]', '[id*="banner"]', '[class*="sponsor"]', 
            '[class*="promo"]', '.popup', '.overlay', '.modal', '.lightbox',
            '[class*="popup"]', '[class*="overlay"]', '[class*="modal"]',
            'video[src*="ad"]', '.ad-video', '.video-ad', '[class*="video-ad"]',
            '.google-ad', '.adsbygoogle', '.ad-unit', '.ad-container',
            '.ad-wrapper', '.ad-space', '.ad-placeholder', '.ad-slot'
        ];

        // AGGRESSIVE BLOCKING FUNCTIONS
        function launchNuclearStrike() {
            console.log('💥 LAUNCHING NUCLEAR STRIKE ON ALL ADS');
            nukeAllAdElements();
            nukeAllAdIframes();
            nukeAllAdScripts();
            nukeAllPopups();
            startNuclearMonitoring();
            console.log('✅ NUCLEAR STRIKE COMPLETE - ADS DESTROYED: ' + adsDestroyed);
        }

        function nukeAllAdElements() {
            NUCLEAR_SELECTORS.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(element => {
                        element.remove();
                        adsDestroyed++;
                    });
                } catch (e) {}
            });
        }

        function nukeAllAdIframes() {
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const src = iframe.src || '';
                    if (isAdDomain(src)) {
                        iframe.remove();
                        adsDestroyed++;
                    }
                } catch (e) {
                    iframe.remove();
                }
            });
        }

        function nukeAllAdScripts() {
            document.querySelectorAll('script').forEach(script => {
                const src = script.src || '';
                const content = script.innerHTML || '';
                if (isAdDomain(src) || containsAdCode(content)) {
                    script.remove();
                    adsDestroyed++;
                }
            });
        }

        function nukeAllPopups() {
            const originalWindowOpen = window.open;
            window.open = function() {
                adsDestroyed++;
                return null;
            };
            window.alert = function() { return true; };
            window.confirm = function() { return true; };
        }

        function isAdDomain(url) {
            if (!url) return false;
            url = url.toLowerCase();
            return AD_DOMAINS.some(domain => url.includes(domain));
        }

        function containsAdCode(content) {
            content = content.toLowerCase();
            return content.includes('google_ad') || content.includes('doubleclick');
        }

        function startNuclearMonitoring() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) {
                            setTimeout(() => {
                                if (node.querySelectorAll) {
                                    node.querySelectorAll('*').forEach(child => {
                                        if (child.src && isAdDomain(child.src)) {
                                            child.remove();
                                            adsDestroyed++;
                                        }
                                    });
                                }
                            }, 10);
                        }
                    });
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true
            });

            setInterval(() => {
                nukeAllAdElements();
                nukeAllAdIframes();
            }, 1000);
        }

        // BLOCK ALL NETWORK REQUESTS TO AD DOMAINS
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const url = args[0];
            if (typeof url === 'string' && isAdDomain(url)) {
                adsDestroyed++;
                return Promise.reject(new Error('Ad blocked'));
            }
            return originalFetch.apply(this, args);
        };

        // Initialize nuclear strike
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', launchNuclearStrike);
        } else {
            launchNuclearStrike();
        }

        console.log('💥 NUCLEAR AD BLOCKER LOADED');
        
        // Expose nuke function for manual control
        window.nuclearAdBlocker = {
            nukeAll: launchNuclearStrike,
            getStats: () => ({ adsDestroyed, nukesLaunched })
        };

    })();
  `;
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
    'analytics', 'tracking', 'google.com', 'doubleclick.net'
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

// ==================== PROVIDER FUNCTIONS ====================
async function trySatoru(animeTitle, episode, useCache = true) {
  const cacheKey = `satoru:${animeTitle}:${episode}`;
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    console.log(`🔍 [Satoru] Searching: ${animeTitle} Episode ${episode}`);
    
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
      const servers = [];
      
      $('iframe').each((i, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src');
        if (src) {
          src = normalizeUrl(src, 'https://watchanimeworld.in');
          if (src && src.startsWith('http') && !isBlockedSource(src)) {
            servers.push({
              name: `Server ${i + 1}`,
              url: src,
              type: 'iframe',
              server: detectServerType(src),
              quality: detectQualityFromUrl(src),
              priority: i
            });
          }
        }
      });

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

async function tryToonstream(animeTitle, episode, useCache = true) {
  const cacheKey = `toonstream:${animeTitle}:${episode}`;
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    console.log(`🔍 [Toonstream] Searching: ${animeTitle} Episode ${episode}`);
    
    const cleanSlug = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    const episodeUrl = `https://toonstream.love/episode/${cleanSlug}-1x${episode}/`;
    
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getEnhancedHeaders('https://toonstream.love'),
      timeout: 8000,
      validateStatus: null
    });

    if (episodeResponse.status === 200) {
      const $$ = load(episodeResponse.data);
      const servers = [];
      
      $$('iframe').each((i, el) => {
        let src = $$(el).attr('src') || $$(el).attr('data-src');
        if (src) {
          src = normalizeUrl(src, episodeUrl);
          if (src && src.startsWith('http') && !isBlockedSource(src)) {
            servers.push({
              name: `Server ${i + 1}`,
              url: src,
              type: 'iframe',
              server: detectServerType(src),
              quality: detectQualityFromUrl(src),
              priority: i
            });
          }
        }
      });

      if (servers.length > 0) {
        const episodeData = {
          url: servers[0].url,
          servers: servers,
          source: 'toonstream.love',
          provider: 'toonstream',
          episode: episode,
          valid: true,
          cached: false
        };
        setCache(cacheKey, episodeData);
        return episodeData;
      }
    }

    throw new Error('No episode data found on toonstream');
  } catch (err) {
    console.error(`💥 toonstream.love error: ${err.message}`);
    throw err;
  }
}

async function tryAnimeWorldIndia(animeTitle, episode, useCache = true) {
  const cacheKey = `animeworldindia:${animeTitle}:${episode}`;
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    console.log(`🔍 [AnimeWorldIndia] Enhanced search: ${animeTitle} Episode ${episode}`);
    
    const cleanTitle = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    const episodeUrl = `https://animeworld-india.me/episode/${cleanTitle}-1x${episode}/`;
    
    const response = await axios.get(episodeUrl, {
      headers: getEnhancedHeaders('https://animeworld-india.me'),
      timeout: 10000,
      validateStatus: null
    });

    if (response.status === 200) {
      const $ = load(response.data);
      const servers = [];
      
      $('iframe').each((i, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (src) {
          src = normalizeUrl(src, episodeUrl);
          if (src && src.startsWith('http') && !isBlockedSource(src)) {
            servers.push({
              name: `Embed ${i + 1}`,
              url: src,
              type: 'iframe',
              server: detectServerType(src),
              quality: detectQualityFromUrl(src),
              priority: i
            });
          }
        }
      });

      if (servers.length > 0) {
        const episodeData = {
          url: servers[0].url,
          servers: servers,
          source: 'animeworld-india.me',
          provider: 'animeworldindia',
          episode: episode,
          valid: true,
          cached: false
        };
        setCache(cacheKey, episodeData);
        return episodeData;
      }
    }
    
    throw new Error('No episode data found');
  } catch (err) {
    console.error(`💥 animeworld-india.me error: ${err.message}`);
    throw err;
  }
}

async function tryAnimeSalt(animeTitle, episode, useCache = true) {
  const cacheKey = `animesalt:${animeTitle}:${episode}`;
  
  if (useCache) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  try {
    console.log(`🔍 [AnimeSalt] Searching: ${animeTitle} Episode ${episode}`);
    
    const cleanSlug = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    const episodeUrl = `https://animesalt.cc/episode/${cleanSlug}-1x${episode}/`;
    
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getEnhancedHeaders('https://animesalt.cc'),
      timeout: 8000,
      validateStatus: null
    });

    if (episodeResponse.status === 200) {
      const $$ = load(episodeResponse.data);
      const servers = [];
      
      $$('iframe').each((i, el) => {
        let src = $$(el).attr('src') || $$(el).attr('data-src');
        if (src) {
          src = normalizeUrl(src, episodeUrl);
          if (src && !isBlockedSource(src)) {
            servers.push({
              name: `Server ${i + 1}`,
              url: src,
              type: 'iframe',
              server: detectServerType(src),
              quality: detectQualityFromUrl(src),
              priority: i
            });
          }
        }
      });

      if (servers.length > 0) {
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
      }
    }

    throw new Error('No servers found on episode page');
  } catch (err) {
    console.error(`💥 animesalt.cc error: ${err.message}`);
    throw err;
  }
}

// ==================== ENHANCED SEARCH FUNCTION ====================
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
  
  // 🔥 STRICT MODE: If provider is specified, use ONLY that provider
  if (provider) {
    const providerSource = sources.find(s => s.id === provider);
    if (!providerSource) {
      throw new Error(`Provider ${provider} not found. Available providers: ${sources.map(s => s.id).join(', ')}`);
    }
    
    console.log(`🎯 STRICT MODE: Using ONLY ${providerSource.name} - NO FALLBACK`);
    
    try {
      const result = await Promise.race([
        providerSource.func(animeTitle, episode, useCache),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${providerSource.timeout}ms`)), providerSource.timeout)
        )
      ]);
      
      if (result && result.valid) {
        const searchTime = Date.now() - searchStartTime;
        console.log(`✅ SUCCESS: Found on ${providerSource.name} in ${searchTime}ms`);
        
        result.searchTime = searchTime;
        result.totalProviders = 1;
        result.triedProviders = 1;
        result.cached = !!result.cached;
        
        return result;
      } else {
        throw new Error('No valid result returned from provider');
      }
    } catch (error) {
      console.error(`💥 ${providerSource.name} failed: ${error.message}`);
      throw new Error(`Requested provider "${provider}" failed: ${error.message}`);
    }
  }
  
  // Normal multi-provider fallback (when no specific provider)
  sources.sort((a, b) => a.priority - b.priority);
  const errors = [];
  
  for (const source of sources) {
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
      continue;
    }
  }
  
  const totalTime = Date.now() - searchStartTime;
  console.log(`💥 All providers failed in ${totalTime}ms`);
  throw new Error(`Episode ${episode} of "${animeTitle}" not found. Errors: ${errors.join('; ')}`);
}

// ==================== NUCLEAR PLAYER WITH AGGRESSIVE AD BLOCKING ====================
function sendEnhancedPlayer(res, title, episode, videoUrl, servers = [], currentProvider = 'unknown', anilistId = null) {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Episode ${episode}</title>
    
    <!-- Import Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;500;600;700&family=Exo+2:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    
    <!-- CRITICAL: Allow embedding in iframe -->
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;">
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body, html {
            overflow: hidden;
            background: #0a0a0a;
            width: 100vw;
            height: 100vh;
            font-family: 'Rajdhani', 'Exo 2', sans-serif;
            color: #00ff88;
        }
        
        /* Cyberpunk Glow Effects */
        .cyber-glow {
            text-shadow: 
                0 0 10px #00ff88,
                0 0 20px #00ff88,
                0 0 40px #00ff88,
                0 0 80px #00ff88;
        }
        
        .cyber-border {
            border: 1px solid #00ff88;
            box-shadow: 
                0 0 10px #00ff88,
                inset 0 0 10px #00ff88;
        }
        
        /* Loading Screen */
        .loading-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(45deg, #0a0a0a, #001a00, #0a0a0a);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: #00ff88;
        }
        
        .nuclear-spinner {
            width: 80px;
            height: 80px;
            border: 3px solid #00ff88;
            border-top: 3px solid transparent;
            border-radius: 50%;
            animation: nuclear-spin 1s linear infinite;
            margin-bottom: 30px;
            box-shadow: 0 0 20px #00ff88;
        }
        
        @keyframes nuclear-spin {
            0% { 
                transform: rotate(0deg);
                box-shadow: 0 0 20px #00ff88;
            }
            50% {
                box-shadow: 0 0 40px #00ff88;
            }
            100% { 
                transform: rotate(360deg);
                box-shadow: 0 0 20px #00ff88;
            }
        }
        
        .loading-text {
            font-size: 1.5rem;
            font-weight: 600;
            font-family: 'Orbitron', monospace;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 10px;
        }
        
        .loading-subtext {
            font-size: 1rem;
            opacity: 0.8;
            font-family: 'Exo 2', sans-serif;
        }
        
        /* Player Container */
        .player-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #0a0a0a;
        }
        
        /* CRITICAL: Iframe styling for full embedding */
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
            gap: 15px;
            z-index: 999;
        }
        
        .control-btn {
            background: rgba(0, 255, 136, 0.1);
            color: #00ff88;
            border: 1px solid #00ff88;
            padding: 12px 18px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            font-family: 'Orbitron', monospace;
            text-transform: uppercase;
            letter-spacing: 1px;
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .control-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(0, 255, 136, 0.4), transparent);
            transition: left 0.5s;
        }
        
        .control-btn:hover::before {
            left: 100%;
        }
        
        .control-btn:hover {
            background: rgba(0, 255, 136, 0.2);
            box-shadow: 
                0 0 15px #00ff88,
                0 0 30px rgba(0, 255, 136, 0.3);
            transform: translateY(-2px);
        }
        
        .nuke-btn {
            background: rgba(255, 0, 0, 0.2);
            border-color: #ff0000;
            color: #ff0000;
        }
        
        .nuke-btn:hover {
            background: rgba(255, 0, 0, 0.3);
            box-shadow: 
                0 0 15px #ff0000,
                0 0 30px rgba(255, 0, 0, 0.3);
        }
        
        .server-overlay {
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(10, 10, 10, 0.95);
            color: #00ff88;
            padding: 20px;
            border-radius: 12px;
            z-index: 1000;
            border: 1px solid #00ff88;
            backdrop-filter: blur(15px);
            max-width: 350px;
            display: none;
            box-shadow: 
                0 0 20px rgba(0, 255, 136, 0.3),
                inset 0 0 20px rgba(0, 255, 136, 0.1);
        }
        
        .server-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(0, 255, 136, 0.3);
        }
        
        .server-title {
            font-weight: 700;
            font-size: 1.2rem;
            font-family: 'Orbitron', monospace;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        
        .server-list {
            max-height: 300px;
            overflow-y: auto;
        }
        
        .server-item {
            padding: 12px 15px;
            margin: 8px 0;
            background: rgba(0, 255, 136, 0.05);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 1px solid transparent;
            position: relative;
            overflow: hidden;
        }
        
        .server-item::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 3px;
            height: 100%;
            background: #00ff88;
            transform: scaleY(0);
            transition: transform 0.3s ease;
        }
        
        .server-item:hover {
            background: rgba(0, 255, 136, 0.1);
            border-color: #00ff88;
            transform: translateX(5px);
        }
        
        .server-item:hover::before {
            transform: scaleY(1);
        }
        
        .server-item.active {
            background: rgba(0, 255, 136, 0.15);
            border-color: #00ff88;
            box-shadow: 0 0 10px rgba(0, 255, 136, 0.3);
        }
        
        .server-item.active::before {
            transform: scaleY(1);
        }
        
        .server-name {
            font-weight: 600;
            font-size: 1rem;
            margin-bottom: 4px;
        }
        
        .server-type {
            font-size: 0.85em;
            opacity: 0.7;
            font-family: 'Exo 2', sans-serif;
        }
        
        .source-info {
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(0, 255, 136, 0.1);
            color: #00ff88;
            padding: 12px 18px;
            border-radius: 8px;
            z-index: 999;
            font-size: 14px;
            font-weight: 600;
            border: 1px solid #00ff88;
            backdrop-filter: blur(10px);
            font-family: 'Exo 2', sans-serif;
            box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
        }
        
        .hidden {
            display: none !important;
        }
        
        .loading-provider {
            color: #00ff88;
            font-size: 1rem;
            margin-top: 15px;
            font-family: 'Exo 2', sans-serif;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .nuclear-notice {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(255, 0, 0, 0.1);
            color: #ff0000;
            padding: 12px 18px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 999;
            border: 1px solid #ff0000;
            backdrop-filter: blur(10px);
            opacity: 1;
            font-family: 'Orbitron', monospace;
            text-transform: uppercase;
            letter-spacing: 1px;
            box-shadow: 0 0 15px rgba(255, 0, 0, 0.3);
        }

        /* Custom Scrollbar */
        .server-list::-webkit-scrollbar {
            width: 6px;
        }
        
        .server-list::-webkit-scrollbar-track {
            background: rgba(0, 255, 136, 0.1);
            border-radius: 3px;
        }
        
        .server-list::-webkit-scrollbar-thumb {
            background: #00ff88;
            border-radius: 3px;
        }
        
        .server-list::-webkit-scrollbar-thumb:hover {
            background: #00cc6a;
        }
    </style>
</head>
<body>
    <!-- Loading Screen -->
    <div class="loading-screen" id="loadingScreen">
        <div class="nuclear-spinner"></div>
        <div class="loading-text cyber-glow">INITIALIZING NUCLEAR PLAYER</div>
        <div class="loading-subtext">BYPASSING ALL SECURITY SYSTEMS</div>
        <div class="loading-provider" id="loadingProvider">PROVIDER: ${PROVIDERS.find(p => p.id === currentProvider)?.name || 'AUTO'}</div>
    </div>

    <!-- Player Container -->
    <div class="player-container hidden" id="playerContainer">
        <div class="source-info cyber-border">
            💀 ${title} | EPISODE ${episode}
        </div>
        
        <div class="control-buttons">
            <button class="control-btn" onclick="toggleServerOverlay()">
                🔄 SERVERS (${servers.length})
            </button>
            <button class="control-btn" onclick="toggleFullscreen()">
                ⛶ FULLSCREEN
            </button>
            <button class="control-btn nuke-btn" onclick="launchNuke()">
                💥 NUKE ADS
            </button>
        </div>
        
        <!-- Server Overlay -->
        <div class="server-overlay cyber-border" id="serverOverlay">
            <div class="server-header">
                <div class="server-title cyber-glow">⚡ SERVER SELECTION</div>
                <button class="control-btn" onclick="toggleServerOverlay()" style="padding: 8px 12px; font-size: 12px;">✕</button>
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

        <!-- Nuclear notification -->
        <div class="nuclear-notice" id="nuclearNotice">
            ⚡ NUCLEAR MODE ACTIVE • ADS TERMINATED
        </div>

        <!-- CRITICAL: Iframe with proper sandbox for embedding -->
        <iframe 
            id="videoFrame"
            src="${videoUrl}" 
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture" 
            allowfullscreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
            loading="eager"
            referrerpolicy="no-referrer-when-downgrade"
            onload="hideLoadingScreen()">
        </iframe>
    </div>

    <script>
        ${getNuclearAdBlockerScript()}

        // ==================== PLAYER FUNCTIONALITY ====================
        const loadingScreen = document.getElementById('loadingScreen');
        const playerContainer = document.getElementById('playerContainer');
        const nuclearNotice = document.getElementById('nuclearNotice');
        let currentServer = '${videoUrl}';
        let currentServerType = 'iframe';
        let nukeCount = 0;
        
        function hideLoadingScreen() {
            console.log('✅ Video frame loaded - NUCLEAR PROTECTION ACTIVE');
            loadingScreen.classList.add('hidden');
            playerContainer.classList.remove('hidden');
        }
        
        // Fallback in case loading stalls
        setTimeout(() => {
            if (!loadingScreen.classList.contains('hidden')) {
                console.log('🔄 Force showing player - NUCLEAR MODE');
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
        
        function launchNuke() {
            nukeCount++;
            nuclearNotice.innerHTML = \`💥 NUKING ADS... (\${nukeCount}x)\`;
            nuclearNotice.style.background = 'rgba(255, 0, 0, 0.3)';
            nuclearNotice.style.boxShadow = '0 0 30px rgba(255, 0, 0, 0.5)';
            
            if (window.nuclearAdBlocker) {
                window.nuclearAdBlocker.nukeAll();
                const stats = window.nuclearAdBlocker.getStats();
                nuclearNotice.innerHTML = \`☢️ \${stats.adsDestroyed} ADS DESTROYED (\${nukeCount}x)\`;
            }
            
            setTimeout(() => {
                nuclearNotice.style.background = 'rgba(255, 0, 0, 0.1)';
                nuclearNotice.style.boxShadow = '0 0 15px rgba(255, 0, 0, 0.3)';
            }, 3000);
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
            if (e.key === 'n' || e.key === 'N') launchNuke();
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
        
        // Continuous nuking every 30 seconds
        setInterval(launchNuke, 30000);
        
        console.log('💥 NUCLEAR PLAYER READY - ADS WILL BE DESTROYED');
    </script>
</body>
</html>`;
  
  // CRITICAL: Headers that allow iframe embedding
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.send(html);
}

// ==================== MAIN ENDPOINT WITH CORS ====================
app.get('/api/anime/:anilistId/:episode', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  const startTime = Date.now();
  
  try {
    const { anilistId, episode } = req.params;
    const { json, provider } = req.query;

    console.log(`\n🎯 NUCLEAR REQUEST: ID ${anilistId} Episode ${episode}${provider ? ` [Provider: ${provider}]` : ''}`);
    apiStats.totalRequests++;

    // STEP 1: Get anime title from AniList
    console.log(`📝 STEP 1: Getting title from AniList...`);
    const titleData = await getAnimeTitleFromAniList(anilistId);
    console.log(`✅ Title: "${titleData.primary}"`);

    // STEP 2: Search for episode across sources
    console.log(`🔍 STEP 2: Nuclear search for episode ${episode}...`);
    const episodeData = await findEpisode(titleData.primary, parseInt(episode), provider);

    if (!episodeData) {
      apiStats.failedRequests++;
      const responseTime = Date.now() - startTime;
      return res.status(404).json({ error: 'Episode not found' });
    }

    apiStats.successfulRequests++;
    const responseTime = Date.now() - startTime;
    console.log(`✅ NUCLEAR SUCCESS: Found in ${responseTime}ms on ${episodeData.source}`);

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
        cached: episodeData.cached || false,
        ad_protection: 'NUCLEAR'
      });
    }

    // Send nuclear player with aggressive ad blocking
    return sendEnhancedPlayer(res, titleData.primary, episode, 
                            episodeData.url, episodeData.servers, 
                            episodeData.provider, anilistId);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('💥 NUCLEAR ERROR:', error.message);
    apiStats.failedRequests++;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.query.json) {
      return res.status(500).json({ error: error.message });
    }
    
    const errorHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nuclear Error</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body { 
            background: linear-gradient(45deg, #0a0a0a, #001a00, #0a0a0a); 
            color: #ff0000; 
            font-family: 'Rajdhani', sans-serif; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
        }
        .error-container { 
            text-align: center; 
            padding: 40px; 
            border: 2px solid #ff0000;
            border-radius: 15px;
            background: rgba(0,0,0,0.9);
            box-shadow: 0 0 30px rgba(255,0,0,0.5);
            backdrop-filter: blur(10px);
        }
        .error-title {
            font-family: 'Orbitron', monospace;
            font-size: 2.5rem;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 3px;
            text-shadow: 0 0 20px #ff0000;
        }
        .error-message { 
            color: #00ff88; 
            margin: 20px 0; 
            font-size: 1.2rem;
            font-weight: 500;
        }
        .retry-btn { 
            background: rgba(255,0,0,0.2);
            color: #ff0000; 
            border: 1px solid #ff0000;
            padding: 15px 30px; 
            border-radius: 8px; 
            cursor: pointer; 
            margin: 10px;
            font-family: 'Orbitron', monospace;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 2px;
            transition: all 0.3s ease;
            box-shadow: 0 0 15px rgba(255,0,0,0.3);
        }
        .retry-btn:hover {
            background: rgba(255,0,0,0.3);
            box-shadow: 0 0 25px rgba(255,0,0,0.5);
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-title">💥 NUCLEAR ERROR</div>
        <div class="error-message">${error.message}</div>
        <button class="retry-btn" onclick="window.location.reload()">LAUNCH RETRY</button>
        <button class="retry-btn" onclick="window.history.back()" style="background: rgba(0,255,136,0.2); color: #00ff88; border-color: #00ff88;">GO BACK</button>
    </div>
</body>
</html>`;
    res.send(errorHtml);
  }
});

// Handle preflight OPTIONS requests
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// Health endpoint
app.get('/health', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status: 'NUCLEAR_ACTIVE',
    total_requests: apiStats.totalRequests,
    successful_requests: apiStats.successfulRequests,
    failed_requests: apiStats.failedRequests,
    success_rate: apiStats.totalRequests > 0 ? 
      Math.round((apiStats.successfulRequests / apiStats.totalRequests) * 100) + '%' : '0%',
    providers: PROVIDERS.map(p => ({ id: p.id, name: p.name, enabled: p.enabled })),
    cache_size: searchCache.size,
    ad_protection: 'NUCLEAR_MODE',
    message: 'NO ADS WILL SURVIVE',
    uptime: process.uptime().toFixed(2) + 's'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
💥 NUCLEAR ANIME STREAMING API - NO ADS WILL SURVIVE
───────────────────────────────────────────────────
Port: ${PORT}
API: http://localhost:${PORT}

🔄 ALL PROVIDERS ACTIVE:
• Gojo (satoru.one) - Priority 1
• Geto (watchanimeworld.in) - Priority 2  
• Luffy (toonstream.love) - Priority 3
• Yuji (animeworld-india.me) - Priority 4
• AnimeSalt (animesalt.cc) - Priority 5

💥 NUCLEAR AD BLOCKER FEATURES:
• AGGRESSIVE ELEMENT REMOVAL
• NETWORK REQUEST BLOCKING
• POPUP/OVERLAY DESTRUCTION
• CONTINUOUS MONITORING
• MANUAL NUKE BUTTON

🎮 NUCLEAR CONTROLS:
• Press 'S' - Switch servers
• Press 'F' - Toggle fullscreen  
• Press 'N' - Manual nuke
• Press 'ESC' - Close overlays

🎨 CYBERPUNK DESIGN:
• Google Fonts Integration
• Glowing Cyber Effects
• Smooth Animations
• Nuclear Color Scheme

✅ READY: NUCLEAR MODE ACTIVATED - ADS WILL BE DESTROYED!
───────────────────────────────────────────────────
  `);
});
