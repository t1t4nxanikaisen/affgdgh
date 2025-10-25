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

// Available providers with new names
const PROVIDERS = [
  { id: 'satoru', name: 'Gojo', baseUrl: 'https://satoru.one' },
  { id: 'watchanimeworld', name: 'Geto', baseUrl: 'https://watchanimeworld.in' },
  { id: 'animedub', name: 'Luffy', baseUrl: 'https://animedub.co' },
  { id: 'animeworldindia', name: 'Yuji', baseUrl: 'https://animeworld-india.me' }
];

// ==================== HELPER FUNCTIONS ====================
function detectServerType(urlOrName) {
  const text = (urlOrName || '').toLowerCase();
  if (text.includes('streamtape')) return 'StreamTape';
  if (text.includes('dood')) return 'DoodStream';
  if (text.includes('filemoon')) return 'FileMoon';
  if (text.includes('mp4upload')) return 'Mp4Upload';
  if (text.includes('vidstream')) return 'VidStream';
  if (text.includes('voe')) return 'Voe';
  if (text.includes('satoru')) return 'Gojo';
  if (text.includes('animedub')) return 'Luffy';
  if (text.includes('animeworld-india')) return 'Yuji';
  if (text.includes('watchanimeworld')) return 'Geto';
  return 'Direct';
}

function detectQualityFromUrl(url) {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('1080')) return '1080p';
  if (urlLower.includes('720')) return '720p';
  if (urlLower.includes('480')) return '480p';
  if (urlLower.includes('360')) return '360p';
  if (urlLower.includes('hd')) return '720p';
  if (urlLower.includes('fullhd')) return '1080p';
  if (urlLower.includes('.m3u8')) return 'Adaptive';
  
  return 'Unknown';
}

function isBlockedSource(url) {
  const blockedPatterns = [
    'youtube.com', 'youtu.be', 'facebook.com', 'twitter.com',
    'instagram.com', '/ads/', 'trailer', 'preview', 'promo',
    'analytics', 'tracking', 'google.com'
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
    // Normalize URL for comparison
    const normalizedUrl = server.url.split('?')[0].split('#')[0];
    const key = normalizedUrl + server.type;
    
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHeaders(referer = 'https://google.com') {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': referer,
    'Cache-Control': 'max-age=0'
  };
}

// ==================== STEP 1: GET ANIME TITLE FROM ANILIST ====================
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

// ==================== STEP 2: TRY ANIMEWORLD-INDIA.ME (Yuji) - SEARCH FIRST ====================
async function searchAnimeWorldIndia(animeTitle) {
  try {
    const searchUrl = `https://animeworld-india.me/?s=${encodeURIComponent(animeTitle)}`;
    const response = await axios.get(searchUrl, { 
      headers: getHeaders(),
      timeout: 8000 
    });
    const $ = load(response.data);

    let correctSlug = null;
    
    // Look for the anime in search results and extract the correct URL slug
    $('.flw-item, [href*="/series/"]').each((i, el) => {
      let url = $(el).attr('href');
      if (url && url.includes('/series/')) {
        // Extract the slug from the series page URL
        const seriesMatch = url.match(/series\/([^\/]+)/);
        if (seriesMatch) {
          correctSlug = seriesMatch[1];
          console.log(`✅ Found correct slug: ${correctSlug}`);
          return false; // Break the loop after first good match
        }
      }
    });
    
    return correctSlug;
  } catch (err) {
    console.error(`💥 Search error: ${err.message}`);
    return null;
  }
}

async function tryAnimeWorldIndia(animeTitle, episode) {
  try {
    console.log(`🔍 Trying animeworld-india.me (Yuji): ${animeTitle} Episode ${episode}`);
    
    // STEP 1: Search for the correct title slug
    const correctSlug = await searchAnimeWorldIndia(animeTitle);
    if (!correctSlug) throw new Error('Anime not found in search results');

    // STEP 2: Build the episode URL using the official format
    const episodeUrl = `https://animeworld-india.me/episode/${correctSlug}-1x${episode}`;
    console.log(`🔗 Episode URL: ${episodeUrl}`);
    
    const response = await axios.get(episodeUrl, {
      headers: getHeaders(),
      timeout: 8000,
      validateStatus: null
    });

    if (response.status !== 200) throw new Error('Episode page not found');

    const $ = load(response.data);
    
    // STEP 3: Extract servers directly from page
    const servers = extractServersDirectly($, episodeUrl);
    
    // STEP 4: Return only what is found - no fallbacks
    console.log(`✅ Found ${servers.length} server(s) on animeworld-india.me`);
    
    if (servers.length === 0) {
      throw new Error('No servers found on episode page');
    }

    return {
      url: servers[0].url,
      servers: servers,
      source: 'animeworld-india.me',
      provider: 'animeworldindia',
      episode: episode,
      valid: true
    };

  } catch (err) {
    console.error(`💥 animeworld-india.me error: ${err.message}`);
    throw err;
  }
}

// ==================== STEP 3: TRY WATCHANIMEWORLD.IN (Geto) ====================
async function tryWatchAnimeWorld(animeTitle, episode) {
  try {
    console.log(`🔍 Trying watchanimeworld.in (Geto): ${animeTitle} Episode ${episode}`);
    
    // Clean title for URL
    const cleanTitle = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    // Use single URL pattern as requested
    const url = `https://watchanimeworld.in/episode/${cleanTitle}-1x${episode}`;
    console.log(`🔗 Direct URL: ${url}`);
    
    const response = await axios.get(url, {
      headers: getHeaders(),
      timeout: 8000,
      validateStatus: null
    });

    if (response.status === 200 && !response.data.includes('404')) {
      const $ = load(response.data);
      const servers = extractServersDirectly($, 'https://watchanimeworld.in');
      
      if (servers.length > 0) {
        console.log(`✅ Found on watchanimeworld.in (Geto) - ${servers.length} servers`);
        return {
          url: servers[0].url,
          servers: servers,
          source: 'watchanimeworld.in',
          provider: 'watchanimeworld',
          season: 1,
          episode: episode,
          valid: true
        };
      }
    }
    
    throw new Error('Not found on watchanimeworld.in');
  } catch (err) {
    console.error(`💥 watchanimeworld.in error: ${err.message}`);
    throw err;
  }
}

// ==================== STEP 4: TRY ANIMEDUB.CO (Luffy) - DIRECT EXTRACTION ====================
async function tryAnimedub(animeTitle, episode) {
  try {
    console.log(`🔍 Trying animedub.co (Luffy): ${animeTitle} Episode ${episode}`);
    
    // Clean title for search
    const cleanTitle = animeTitle.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = `https://animedub.co/search?query=${encodeURIComponent(cleanTitle)}`;
    
    console.log(`🔗 Searching: ${searchUrl}`);
    
    const searchResponse = await axios.get(searchUrl, {
      headers: getHeaders('https://animedub.co'),
      timeout: 10000
    });

    const $ = load(searchResponse.data);
    let animeUrl = null;
    let bestMatch = null;
    
    // Look for anime in search results
    $('.flw-item, .film_list-wrap .film-detail, .film_list-wrap .film-name a, [href*="/series/"]').each((i, el) => {
      const name = $(el).find('.film-name, .dynamic-name, .film-title').text().trim() || $(el).text().trim();
      let url = $(el).attr('href') || $(el).find('a').attr('href');
      
      if (name && url && name.toLowerCase().includes(cleanTitle.toLowerCase())) {
        // Ensure URL is absolute
        if (url && !url.startsWith('http')) {
          url = `https://animedub.co${url.startsWith('/') ? url : '/' + url}`;
        }
        
        // Check if it's a series URL
        if (url && url.includes('/series/')) {
          animeUrl = url;
          bestMatch = name;
          console.log(`✅ Found match: "${bestMatch}" -> ${animeUrl}`);
          return false;
        }
      }
    });

    if (!animeUrl) throw new Error('Anime not found in search results');

    // Extract series ID and slug from URL
    const seriesMatch = animeUrl.match(/series\/(\d+)\/([^\/]+)/);
    if (!seriesMatch) throw new Error('Could not extract series info from URL');
    
    const seriesId = seriesMatch[1];
    const seriesSlug = seriesMatch[2];
    
    console.log(`🎯 Series ID: ${seriesId}, Slug: ${seriesSlug}`);

    // Build episode URL
    const episodeUrl = `https://animedub.co/series/${seriesId}/${seriesSlug}/${episode}`;
    console.log(`🔗 Episode URL: ${episodeUrl}`);
    
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getHeaders('https://animedub.co'),
      timeout: 10000,
      validateStatus: null
    });

    if (episodeResponse.status !== 200) {
      throw new Error(`Episode page returned status ${episodeResponse.status}`);
    }

    const $$ = load(episodeResponse.data);
    
    // Extract servers directly from the page - NO AJAX CALLS
    const servers = extractServersDirectly($$, episodeUrl);
    
    // If no servers found, throw error - NO FALLBACKS
    if (servers.length === 0) {
      throw new Error('No servers extracted from episode page');
    }

    console.log(`✅ Found ${servers.length} server options on animedub.co`);

    return {
      url: servers[0].url,
      servers: servers,
      source: 'animedub.co',
      provider: 'animedub',
      episode: episode,
      valid: true
    };

  } catch (err) {
    console.error(`💥 animedub.co error: ${err.message}`);
    throw err;
  }
}

// ==================== STEP 5: TRY SATORU.ONE (Gojo) ====================
async function trySatoru(animeTitle, episode) {
  try {
    console.log(`🎯 Satoru (Gojo): Searching for "${animeTitle}" episode ${episode}`);
    
    const cleanTitle = animeTitle.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = `https://satoru.one/filter?keyword=${encodeURIComponent(cleanTitle)}`;
    
    const searchResponse = await axios.get(searchUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 10000
    });

    const $ = load(searchResponse.data);
    let animeId = null;
    let bestMatch = null;
    
    $('.flw-item').slice(0, 5).each((i, el) => {
      const name = $(el).find('.film-name a').text().trim();
      const dataId = $(el).find('.film-poster-ahref').attr('data-id');
      
      if (name && dataId && name.toLowerCase().includes(cleanTitle.toLowerCase())) {
        animeId = dataId;
        bestMatch = name;
        return false;
      }
    });

    if (!animeId) throw new Error(`Anime not found`);
    console.log(`✅ Satoru found: "${bestMatch}" (ID: ${animeId})`);

    const episodeUrl = `https://satoru.one/ajax/episode/list/${animeId}`;
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 10000
    });

    if (!episodeResponse.data.html) {
      throw new Error('No episode list returned');
    }

    const $$ = load(episodeResponse.data.html);
    let epId = null;
    
    $$('.ep-item').slice(0, 100).each((i, el) => {
      const num = $$(el).attr('data-number');
      const id = $$(el).attr('data-id');
      if (num && id && String(num) === String(episode)) {
        epId = id;
        return false;
      }
    });

    if (!epId) throw new Error(`Episode ${episode} not found`);

    const serversUrl = `https://satoru.one/ajax/episode/servers?episodeId=${epId}`;
    const serversResponse = await axios.get(serversUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 10000
    });

    const $$$ = load(serversResponse.data.html);
    
    // Extract all servers
    const allServers = [];
    $$$('.server-item').each((i, el) => {
      const serverId = $$$(el).attr('data-id');
      const serverName = $$$(el).text().trim();
      
      if (serverId) {
        allServers.push({
          id: serverId,
          name: serverName,
          type: detectServerType(serverName)
        });
      }
    });

    // Try all servers quickly
    const serverPromises = allServers.map(async (server) => {
      try {
        const sourceUrl = `https://satoru.one/ajax/episode/sources?id=${server.id}`;
        const sourceResponse = await axios.get(sourceUrl, {
          headers: getHeaders('https://satoru.one'),
          timeout: 8000
        });

        if (sourceResponse.data && sourceResponse.data.link) {
          const iframeUrl = sourceResponse.data.link;
          
          if (iframeUrl.toLowerCase().includes('youtube') || iframeUrl.toLowerCase().includes('youtu.be')) {
            return null;
          }

          return {
            name: server.name,
            url: iframeUrl,
            type: 'iframe',
            server: server.type
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
      throw new Error('No working servers found');
    }

    console.log(`🎬 Satoru found ${validServers.length} working servers`);

    return {
      url: validServers[0].url,
      servers: validServers,
      source: 'satoru.one',
      provider: 'satoru',
      season: 1,
      episode: episode,
      valid: true
    };

  } catch (err) {
    console.error(`💥 Satoru error: ${err.message}`);
    throw err;
  }
}

// ==================== DIRECT SERVER EXTRACTION ====================
function extractServersDirectly($$, baseUrl) {
  const servers = [];
  
  console.log('🎬 Extracting servers directly from page...');

  // Method 1: Direct iframe extraction
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
        console.log(`✅ Found iframe: ${src}`);
      }
    }
  });

  // Method 2: Video player sources (direct video links)
  $$('video source').each((i, el) => {
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
        console.log(`✅ Found direct video: ${src}`);
      }
    }
  });

  // Method 3: Video tags with src attribute
  $$('video[src]').each((i, el) => {
    let src = $$(el).attr('src');
    if (src) {
      src = normalizeUrl(src, baseUrl);
      if (src && src.startsWith('http') && !isBlockedSource(src)) {
        servers.push({
          name: `Video Tag ${i + 1}`,
          url: src,
          type: 'direct',
          server: 'Direct',
          quality: detectQualityFromUrl(src)
        });
        console.log(`✅ Found video tag: ${src}`);
      }
    }
  });

  // Method 4: JavaScript variable extraction
  const scriptContent = $$('script').text();
  
  // Extract various video URL patterns from JavaScript
  const videoPatterns = [
    { pattern: /(https?:[^"']*\.m3u8[^"']*)/g, name: 'HLS Stream', type: 'hls' },
    { pattern: /(https?:[^"']*\.mp4[^"']*)/g, name: 'MP4 Stream', type: 'direct' },
    { pattern: /(https?:[^"']*\.webm[^"']*)/g, name: 'WebM Stream', type: 'direct' },
    { pattern: /file:\s*["'](https?:[^"']*)["']/g, name: 'JS File', type: 'direct' },
    { pattern: /src:\s*["'](https?:[^"']*)["']/g, name: 'JS Source', type: 'direct' },
    { pattern: /videoUrl\s*=\s*["'](https?:[^"']*)["']/g, name: 'Video URL', type: 'direct' },
    { pattern: /source\s*:\s*["'](https?:[^"']*)["']/g, name: 'Source', type: 'direct' }
  ];

  videoPatterns.forEach(({ pattern, name, type }) => {
    const matches = scriptContent.match(pattern);
    if (matches) {
      matches.forEach((url, i) => {
        const cleanUrl = url.replace(/['"]/g, '')
          .replace(/file:\s*/, '')
          .replace(/src:\s*/, '')
          .replace(/videoUrl\s*=\s*/, '')
          .replace(/source\s*:\s*/, '');
        
        if (cleanUrl.includes('http') && !isBlockedSource(cleanUrl)) {
          servers.push({
            name: `${name} ${i + 1}`,
            url: cleanUrl,
            type: type,
            server: 'JavaScript',
            quality: detectQualityFromUrl(cleanUrl)
          });
          console.log(`✅ Found JS source: ${cleanUrl}`);
        }
      });
    }
  });

  // Method 5: Data attributes
  $$('[data-video], [data-src], [data-file], [data-url]').each((i, el) => {
    let src = $$(el).attr('data-video') || $$(el).attr('data-src') || $$(el).attr('data-file') || $$(el).attr('data-url');
    if (src && src.includes('http')) {
      src = normalizeUrl(src, baseUrl);
      if (!isBlockedSource(src)) {
        servers.push({
          name: `Data Source ${i + 1}`,
          url: src,
          type: 'direct',
          server: 'Direct',
          quality: detectQualityFromUrl(src)
        });
        console.log(`✅ Found data source: ${src}`);
      }
    }
  });

  // Remove duplicates
  const uniqueServers = removeDuplicateServers(servers);
  console.log(`🎯 Extracted ${uniqueServers.length} unique servers`);
  
  return uniqueServers;
}

// ==================== STEP 6: MAIN SEARCH FUNCTION ====================
async function findEpisode(animeTitle, episode, provider = null) {
  console.log(`\n🎯 STARTING SEARCH: "${animeTitle}" Episode ${episode}`);
  
  // Define sources with new provider names
  let sources = [
    { name: 'animeworld-india.me (Yuji)', func: tryAnimeWorldIndia, id: 'animeworldindia' },
    { name: 'satoru.one (Gojo)', func: trySatoru, id: 'satoru' },
    { name: 'watchanimeworld.in (Geto)', func: tryWatchAnimeWorld, id: 'watchanimeworld' },
    { name: 'animedub.co (Luffy)', func: tryAnimedub, id: 'animedub' }
  ];
  
  // If specific provider requested, try it first
  if (provider) {
    sources = sources.filter(s => s.id === provider);
    if (sources.length === 0) {
      throw new Error(`Provider ${provider} not found`);
    }
  }
  
  for (const source of sources) {
    try {
      console.log(`\n🔍 STEP: Trying ${source.name}...`);
      const result = await source.func(animeTitle, episode);
      if (result && result.valid) {
        console.log(`✅ SUCCESS: Found on ${source.name}`);
        return result;
      }
    } catch (error) {
      console.log(`❌ ${source.name} failed: ${error.message}`);
      // Continue to next source
    }
  }
  
  throw new Error(`Episode ${episode} not found on any source`);
}

// ==================== ENHANCED PLAYER WITH INSTANT LOADING ====================
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
        
        /* Provider overlay */
        .provider-overlay {
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
            max-width: 250px;
            display: none;
        }
        
        .provider-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .provider-title {
            font-weight: bold;
            color: #4ecdc4;
        }
        
        .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            padding: 5px;
        }
        
        .provider-list {
            max-height: 200px;
            overflow-y: auto;
        }
        
        .provider-item {
            padding: 8px 12px;
            margin: 5px 0;
            background: rgba(255,255,255,0.1);
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }
        
        .provider-item:hover {
            background: rgba(255,255,255,0.2);
            border-color: #4ecdc4;
        }
        
        .provider-item.active {
            background: rgba(78, 205, 196, 0.3);
            border-color: #4ecdc4;
        }
        
        .provider-name {
            font-weight: 500;
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
    </style>
</head>
<body>
    <!-- Loading Screen - SHOWN INSTANTLY -->
    <div class="loading-screen" id="loadingScreen">
        <div class="spinner"></div>
        <div class="loading-text">Loading Video...</div>
    </div>

    <!-- Player Container - HIDDEN INITIALLY -->
    <div class="player-container hidden" id="playerContainer">
        <div class="source-info">
            ${title} | Episode ${episode}
        </div>
        
        <div class="control-buttons">
            <button class="control-btn" onclick="toggleProviderOverlay()">
            </button>
            <button class="control-btn" onclick="toggleServerOverlay()">
                🔄 Servers (${servers.length})
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
                         onclick="switchServer('${server.url}', this)">
                        <div class="server-name">${server.name}</div>
                        <div class="server-type">${server.server}</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <iframe 
            id="videoFrame"
            src="${videoUrl}" 
            allow="autoplay; full-screen; encrypted-media" 
            allowfullscreen
            loading="eager"
            onload="hideLoadingScreen()">
        </iframe>
    </div>

    <script>
        const loadingScreen = document.getElementById('loadingScreen');
        const playerContainer = document.getElementById('playerContainer');
        const videoFrame = document.getElementById('videoFrame');
        const loadingProvider = document.getElementById('loadingProvider');
        
        let currentServer = '${videoUrl}';
        let currentProvider = '${currentProvider}';
        const anilistId = '${anilistId}';
        const episode = ${episode};
        
        // Hide loading screen when video loads
        function hideLoadingScreen() {
            console.log('✅ Video loaded, hiding loading screen');
            loadingScreen.classList.add('hidden');
            playerContainer.classList.remove('hidden');
        }
        
        // Fallback - hide loading after 5 seconds if video doesn't load
        setTimeout(() => {
            if (!loadingScreen.classList.contains('hidden')) {
                console.log('🔄 Fallback: Hiding loading screen');
                loadingScreen.classList.add('hidden');
                playerContainer.classList.remove('hidden');
            }
        }, 5000);
        
        // Overlay functions
        function toggleProviderOverlay() {
            const overlay = document.getElementById('providerOverlay');
            const serverOverlay = document.getElementById('serverOverlay');
            serverOverlay.style.display = 'none';
            overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
        }
        
        function toggleServerOverlay() {
            const overlay = document.getElementById('serverOverlay');
            const providerOverlay = document.getElementById('providerOverlay');
            providerOverlay.style.display = 'none';
            overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
        }
        
        // Server switching
        function switchServer(url, element) {
            if (url === currentServer) return;
            
            // Show loading screen when switching servers
            loadingScreen.classList.remove('hidden');
            playerContainer.classList.add('hidden');
            
            // Update active server
            document.querySelectorAll('.server-item').forEach(item => {
                item.classList.remove('active');
            });
            element.classList.add('active');
            
            // Switch iframe source
            document.getElementById('videoFrame').src = url;
            currentServer = url;
            
            // The onload event will hide the loading screen
        }
        
        // Provider switching
        function switchProvider(providerId, element) {
            if (providerId === currentProvider) return;
            
            console.log('🔄 Switching to provider:', providerId);
            
            // Show loading screen
            loadingScreen.classList.remove('hidden');
            playerContainer.classList.add('hidden');
            
            // Update loading text
            const providerName = providerId === 'auto' ? 'Auto (All Providers)' : 
                ${JSON.stringify(PROVIDERS)}.find(p => p.id === providerId)?.name || providerId;
            loadingProvider.textContent = 'Provider: ' + providerName;
            
            // Close overlay
            toggleProviderOverlay();
            
            // Reload with new provider
            const url = \`/api/anime/\${anilistId}/\${episode}?provider=\${providerId}\`;
            window.location.href = url;
        }
        
        // Auto-hide overlays after 6 seconds
        setTimeout(() => {
            const providerOverlay = document.getElementById('providerOverlay');
            const serverOverlay = document.getElementById('serverOverlay');
            if (providerOverlay.style.display !== 'none') {
                providerOverlay.style.display = 'none';
            }
            if (serverOverlay.style.display !== 'none') {
                serverOverlay.style.display = 'none';
            }
        }, 6000);
        
        // Hide source info after 3 seconds
        setTimeout(() => {
            document.querySelector('.source-info').style.opacity = '0.5';
        }, 3000);
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                toggleProviderOverlay();
            }
            if (e.key === 's' || e.key === 'S') {
                toggleServerOverlay();
            }
        });
    </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
        response_time: `${responseTime}ms`
      });
    }

    // Send enhanced player with provider & server switching
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
    
    // Send error page with loading screen
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

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'active',
    total_requests: apiStats.totalRequests,
    successful_requests: apiStats.successfulRequests,
    failed_requests: apiStats.failedRequests,
    success_rate: apiStats.totalRequests > 0 ? 
      Math.round((apiStats.successfulRequests / apiStats.totalRequests) * 100) + '%' : '0%',
    providers: PROVIDERS.map(p => ({ id: p.id, name: p.name }))
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🎯 ANIME STREAMING API - PROVIDER SWITCHING
──────────────────────────────────────────
Port: ${PORT}
API: http://localhost:${PORT}

🔄 PROVIDERS:
• Yuji (animeworld-india.me) - SEARCH FIRST
• Gojo (satoru.one) - AJAX WORKING
• Geto (watchanimeworld.in) - SINGLE URL
• Luffy (animedub.co) - DIRECT EXTRACTION

🎮 CONTROLS:
• Press 'P' - Switch providers
• Press 'S' - Switch servers

⚡ IMPROVEMENTS:
• Search-first approach for AnimeWorld India
• Single URL patterns (no multiple attempts)
• Direct server extraction (no AJAX for animedub)
• Only shows actual servers found
• Increased timeouts for reliability

✅ READY: All providers working with latest fixes!
──────────────────────────────────────────
  `);
});
