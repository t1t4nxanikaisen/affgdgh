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

// ONLY 3 SOURCES AS REQUESTED
const SOURCES = [
  {
    name: 'satoru.one',
    baseUrl: 'https://satoru.one',
    searchUrl: 'https://satoru.one/filter?keyword=',
    patterns: []
  },
  {
    name: 'watchanimeworld.in',
    baseUrl: 'https://watchanimeworld.in',
    searchUrl: 'https://watchanimeworld.in/?s=',
    patterns: [
      '/episode/{slug}-episode-{episode}/',
      '/{slug}-episode-{episode}/'
    ]
  },
  {
    name: 'animeworld-india.me', 
    baseUrl: 'https://animeworld-india.me',
    searchUrl: 'https://animeworld-india.me/?s=',
    patterns: [
      '/episode/{slug}-episode-{episode}/',
      '/{slug}-episode-{episode}/'
    ]
  }
];

// ==================== OPTIMIZED HEADERS FUNCTION ====================
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

// ==================== ULTRA-FAST ANILIST INTEGRATION ====================
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
      timeout: 5000,
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

// ==================== SMART EPISODE FINDER WITH AUTO-DETECTION ====================
async function findEpisodeAcrossSeasons(animeTitle, targetEpisode) {
  console.log(`🎯 SMART SEARCH: Looking for episode ${targetEpisode} of "${animeTitle}"`);
  
  // PHASE 1: Try exact episode in each season first
  for (let season = 1; season <= 3; season++) {
    try {
      console.log(`🔍 PHASE 1: Trying Season ${season}, Episode ${targetEpisode}`);
      
      const episodeData = await searchAllSourcesParallel(animeTitle, season, targetEpisode);
      
      if (episodeData) {
        console.log(`✅ FOUND: Season ${season}, Episode ${targetEpisode}`);
        return {
          ...episodeData,
          actualSeason: season,
          actualEpisode: targetEpisode,
          requestedEpisode: targetEpisode,
          mappingType: 'exact'
        };
      }
      console.log(`❌ Not found in Season ${season}`);
    } catch (error) {
      console.log(`❌ Season ${season} search failed: ${error.message}`);
    }
  }
  
  // PHASE 2: Intelligent season detection with auto-calculation
  console.log(`🔍 PHASE 2: Intelligent season detection for episode ${targetEpisode}`);
  
  // Try to detect the actual episode count per season by testing boundaries
  const commonBoundaries = [12, 13, 24, 25, 26];
  
  for (let season = 1; season <= 3; season++) {
    for (const boundary of commonBoundaries) {
      if (targetEpisode > boundary) {
        const calculatedEpisode = targetEpisode - boundary;
        
        // Only try reasonable episode numbers (1-30)
        if (calculatedEpisode >= 1 && calculatedEpisode <= 30) {
          console.log(`🔄 Trying Season ${season + 1}, Episode ${calculatedEpisode} (${targetEpisode} - ${boundary})`);
          
          try {
            const episodeData = await searchAllSourcesParallel(animeTitle, season + 1, calculatedEpisode);
            
            if (episodeData) {
              console.log(`✅ SMART MAPPING: Episode ${targetEpisode} → Season ${season + 1}, Episode ${calculatedEpisode}`);
              return {
                ...episodeData,
                actualSeason: season + 1,
                actualEpisode: calculatedEpisode,
                requestedEpisode: targetEpisode,
                mappingType: 'calculated',
                calculation: `${targetEpisode} - ${boundary} = ${calculatedEpisode}`
              };
            }
          } catch (error) {
            // Continue to next boundary
          }
        }
      }
    }
  }
  
  // PHASE 3: Progressive calculation (most accurate)
  console.log(`🔍 PHASE 3: Progressive calculation for episode ${targetEpisode}`);
  
  for (let season = 2; season <= 5; season++) {
    // Test different episode counts per season
    for (const epCount of [12, 13, 24, 25, 26]) {
      const episodesInPreviousSeasons = epCount * (season - 1);
      const calculatedEpisode = targetEpisode - episodesInPreviousSeasons;
      
      if (calculatedEpisode >= 1 && calculatedEpisode <= epCount) {
        console.log(`🔄 Progressive: Season ${season}, Episode ${calculatedEpisode} (${targetEpisode} - ${episodesInPreviousSeasons})`);
        
        try {
          const episodeData = await searchAllSourcesParallel(animeTitle, season, calculatedEpisode);
          
          if (episodeData) {
            console.log(`✅ PROGRESSIVE MAPPING: Episode ${targetEpisode} → Season ${season}, Episode ${calculatedEpisode}`);
            return {
              ...episodeData,
              actualSeason: season,
              actualEpisode: calculatedEpisode,
              requestedEpisode: targetEpisode,
              mappingType: 'progressive',
              calculation: `${targetEpisode} - ${episodesInPreviousSeasons} = ${calculatedEpisode}`
            };
          }
        } catch (error) {
          // Continue to next calculation
        }
      }
    }
  }
  
  // FINAL FALLBACK: Try episode 1 of each season
  console.log(`🔍 FINAL FALLBACK: Trying episode 1 of each season`);
  
  for (let season = 1; season <= 3; season++) {
    try {
      console.log(`🔄 Fallback: Season ${season}, Episode 1`);
      
      const episodeData = await searchAllSourcesParallel(animeTitle, season, 1);
      
      if (episodeData) {
        console.log(`✅ FALLBACK FOUND: Season ${season}, Episode 1`);
        return {
          ...episodeData,
          actualSeason: season,
          actualEpisode: 1,
          requestedEpisode: targetEpisode,
          mappingType: 'fallback'
        };
      }
    } catch (error) {
      console.log(`❌ Fallback Season ${season} failed: ${error.message}`);
    }
  }
  
  throw new Error(`Episode ${targetEpisode} not found across multiple seasons`);
}

// ==================== ULTRA-FAST SATORU SCRAPING ====================
async function findSatoruEpisode(animeTitle, episodeNum) {
  try {
    console.log(`🎯 Satoru: Searching for "${animeTitle}" episode ${episodeNum}`);
    
    const cleanTitle = animeTitle.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = `https://satoru.one/filter?keyword=${encodeURIComponent(cleanTitle)}`;
    
    const searchResponse = await axios.get(searchUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 8000
    });

    const $ = load(searchResponse.data);
    let animeId = null;
    let bestMatch = null;
    
    $('.flw-item').slice(0, 5).each((i, el) => {
      const name = $(el).find('.film-name a').text().trim();
      const dataId = $(el).find('.film-poster-ahref').attr('data-id');
      
      if (name && dataId) {
        if (name.toLowerCase() === cleanTitle.toLowerCase()) {
          animeId = dataId;
          bestMatch = name;
          return false;
        }
        if (name.toLowerCase().includes(cleanTitle.toLowerCase()) && !animeId) {
          animeId = dataId;
          bestMatch = name;
        }
      }
    });

    if (!animeId) {
      const firstItem = $('.flw-item').first();
      if (firstItem.length) {
        animeId = firstItem.find('.film-poster-ahref').attr('data-id');
        bestMatch = firstItem.find('.film-name a').text().trim();
      }
    }

    if (!animeId) throw new Error(`Anime not found`);
    console.log(`✅ Satoru found: "${bestMatch}" (ID: ${animeId})`);

    const episodeUrl = `https://satoru.one/ajax/episode/list/${animeId}`;
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 8000
    });

    if (!episodeResponse.data.html) {
      throw new Error('No episode list returned');
    }

    const $$ = load(episodeResponse.data.html);
    let epId = null;
    
    $$('.ep-item').slice(0, 100).each((i, el) => {
      const num = $$(el).attr('data-number');
      const id = $$(el).attr('data-id');
      if (num && id && String(num) === String(episodeNum)) {
        epId = id;
        return false;
      }
    });

    if (!epId) throw new Error(`Episode ${episodeNum} not found`);

    const serversUrl = `https://satoru.one/ajax/episode/servers?episodeId=${epId}`;
    const serversResponse = await axios.get(serversUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 8000
    });

    const $$$ = load(serversResponse.data.html);
    const serverItem = $$$('.server-item').first();
    
    if (!serverItem.length) throw new Error('No servers available');
    
    const serverSourceId = serverItem.attr('data-id');
    if (!serverSourceId) throw new Error('No server source ID found');

    const sourceUrl = `https://satoru.one/ajax/episode/sources?id=${serverSourceId}`;
    const sourceResponse = await axios.get(sourceUrl, {
      headers: getHeaders('https://satoru.one'),
      timeout: 8000
    });

    if (!sourceResponse.data || sourceResponse.data.type !== 'iframe') {
      throw new Error('No iframe source available');
    }
    
    const iframeUrl = sourceResponse.data.link;
    if (!iframeUrl) throw new Error('No iframe URL returned');

    if (iframeUrl.toLowerCase().includes('youtube') || iframeUrl.toLowerCase().includes('youtu.be')) {
      throw new Error('YouTube source filtered out');
    }

    console.log(`🎬 Satoru iframe URL found`);

    return {
      url: iframeUrl,
      servers: [{
        name: 'Satoru Stream',
        url: iframeUrl,
        type: 'iframe',
        server: 'Satoru'
      }],
      source: 'satoru.one',
      valid: true
    };

  } catch (err) {
    console.error(`💥 Satoru error: ${err.message}`);
    throw new Error(`Satoru: ${err.message}`);
  }
}

// ==================== ULTRA-FAST ANIMEWORLD SCRAPING ====================
async function findAnimeWorldEpisode(animeTitle, season, episode, sourceName) {
  const source = SOURCES.find(s => s.name === sourceName);
  if (!source) return null;

  try {
    console.log(`🔍 ${source.name}: Searching for "${animeTitle}" S${season}E${episode}`);
    
    const searchUrl = `${source.searchUrl}${encodeURIComponent(animeTitle)}`;
    const searchResponse = await axios.get(searchUrl, {
      headers: getHeaders(source.baseUrl),
      timeout: 8000
    });

    const $ = load(searchResponse.data);
    let slug = null;
    let foundTitle = null;
    
    $('.item, .post, .anime-card, article, .film-list, .series-item').slice(0, 10).each((i, el) => {
      const $el = $(el);
      const title = $el.find('h3, h2, .title, a, .name, .entry-title').first().text().trim();
      const url = $el.find('a').first().attr('href');
      
      if (title && url) {
        const titleLower = title.toLowerCase();
        const searchLower = animeTitle.toLowerCase();
        
        if (titleLower.includes(searchLower) || searchLower.includes(titleLower)) {
          const slugMatch = url.match(/\/(anime|series)\/([^\/]+)/) || 
                           url.match(/\/([^\/]+)-episode/) ||
                           url.match(/\/([^\/]+)$/);
          
          if (slugMatch) {
            slug = slugMatch[2] || slugMatch[1];
            foundTitle = title;
            console.log(`✅ ${source.name} found: "${title}" -> ${slug}`);
            return false;
          }
        }
      }
    });

    if (!slug) throw new Error('Anime not found in search results');

    const patternPromises = source.patterns.map(async (pattern) => {
      const url = buildEpisodeUrl(pattern, slug, episode, source.baseUrl);
      
      try {
        console.log(`🔗 Trying ${source.name}: ${url}`);
        const episodeData = await tryEpisodeUrl(url, source.baseUrl);
        if (episodeData && episodeData.servers.length > 0) {
          return {
            ...episodeData,
            source: source.name,
            usedPattern: pattern
          };
        }
      } catch (error) {
        return null;
      }
    });

    const results = await Promise.allSettled(patternPromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }

    throw new Error('No working episodes found');

  } catch (err) {
    console.error(`💥 ${source.name} error: ${err.message}`);
    throw new Error(`${source.name}: ${err.message}`);
  }
}

// ==================== PARALLEL SOURCE SEARCH ====================
async function searchAllSourcesParallel(animeTitle, season, episode) {
  const promises = [];
  
  for (const source of SOURCES) {
    const promise = (async () => {
      try {
        if (source.name === 'satoru.one') {
          return await findSatoruEpisode(animeTitle, episode);
        } else {
          return await findAnimeWorldEpisode(animeTitle, season, episode, source.name);
        }
      } catch (error) {
        return null;
      }
    })();
    
    promises.push(promise);
  }

  const results = await Promise.allSettled(promises);
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }
  
  return null;
}

// ==================== OPTIMIZED EPISODE URL TESTER ====================
async function tryEpisodeUrl(url, baseUrl) {
  try {
    const response = await axios.get(url, {
      headers: getHeaders(baseUrl),
      timeout: 8000,
      validateStatus: () => true
    });

    if (response.status !== 200) return null;
    if (response.data.includes('404') || response.data.includes('Not Found')) return null;

    const $ = load(response.data);
    const servers = extractAllServers($, baseUrl);
    
    const filteredServers = servers.filter(server => 
      server.url && 
      !server.url.toLowerCase().includes('youtube') && 
      !server.url.toLowerCase().includes('youtu.be') &&
      server.url.startsWith('http')
    );
    
    return filteredServers.length > 0 ? {
      url: url,
      servers: filteredServers,
      valid: true
    } : null;

  } catch (error) {
    throw new Error(`URL failed: ${error.message}`);
  }
}

// ==================== IMPROVED HELPER FUNCTIONS ====================
function extractAllServers($, baseUrl) {
  const servers = [];
  
  $('iframe').slice(0, 5).each((i, el) => {
    let src = $(el).attr('src') || $(el).attr('data-src');
    if (src) {
      src = normalizeUrl(src, baseUrl);
      if (src && src.startsWith('http')) {
        servers.push({
          name: `Server ${i + 1}`,
          url: src,
          type: 'iframe',
          server: detectServerType(src)
        });
      }
    }
  });

  $('video source').slice(0, 3).each((i, el) => {
    let src = $(el).attr('src');
    if (src) {
      src = normalizeUrl(src, baseUrl);
      if (src && src.startsWith('http') && !src.includes('youtube')) {
        servers.push({
          name: `Direct Video ${i + 1}`,
          url: src,
          type: 'direct',
          server: 'Direct'
        });
      }
    }
  });

  return servers;
}

function buildEpisodeUrl(pattern, slug, episode, baseUrl) {
  let url = pattern
    .replace('{slug}', slug)
    .replace('{episode}', episode);
  
  return url.startsWith('http') ? url : baseUrl + url;
}

function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return baseUrl + url;
  if (url.startsWith('http')) return url;
  return baseUrl + url;
}

function detectServerType(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('streamtape')) return 'StreamTape';
  if (urlLower.includes('dood')) return 'DoodStream';
  if (urlLower.includes('filemoon')) return 'FileMoon';
  if (urlLower.includes('mp4upload')) return 'Mp4Upload';
  if (urlLower.includes('vidstream')) return 'VidStream';
  if (urlLower.includes('voe')) return 'Voe';
  if (urlLower.includes('satoru')) return 'Satoru';
  return 'Direct';
}

// ==================== PROFESSIONAL ERROR SCREEN ====================
function sendErrorScreen(res, title, episode, errorMessage, anilistId = null) {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Episode ${episode} | Not Found</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body, html {
            overflow: hidden;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
            width: 100vw;
            height: 100vh;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
        }
        
        .error-container {
            text-align: center;
            padding: 3rem;
            max-width: 600px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 20px;
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }
        
        .error-icon {
            font-size: 5rem;
            margin-bottom: 2rem;
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
        
        .error-title {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            background: linear-gradient(45deg, #ff6b6b, #ff8e8e, #ff6b6b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            font-weight: bold;
        }
        
        .anime-info {
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
            color: #4ecdc4;
            font-weight: 600;
        }
        
        .error-message {
            font-size: 1.1rem;
            margin-bottom: 2rem;
            color: #e0e0e0;
            line-height: 1.6;
            opacity: 0.9;
        }
        
        .suggestions {
            background: rgba(255, 255, 255, 0.08);
            padding: 1.5rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            text-align: left;
        }
        
        .suggestions h3 {
            color: #4ecdc4;
            margin-bottom: 1rem;
            font-size: 1.2rem;
        }
        
        .suggestions ul {
            list-style: none;
            padding-left: 1rem;
        }
        
        .suggestions li {
            margin-bottom: 0.5rem;
            color: #b0b0b0;
            position: relative;
            padding-left: 1.5rem;
        }
        
        .suggestions li:before {
            content: '•';
            color: #ff6b6b;
            position: absolute;
            left: 0;
            font-size: 1.2rem;
        }
        
        .action-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 25px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-primary {
            background: linear-gradient(45deg, #4ecdc4, #45b7d1);
            color: white;
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        
        .technical-info {
            margin-top: 2rem;
            padding-top: 1.5rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            font-size: 0.9rem;
            color: #888;
        }
        
        @media (max-width: 768px) {
            .error-container {
                margin: 1rem;
                padding: 2rem;
            }
            
            .error-title {
                font-size: 2rem;
            }
            
            .anime-info {
                font-size: 1.2rem;
            }
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">🎭</div>
        <h1 class="error-title">Anime Not Found</h1>
        <div class="anime-info">"${title}" - Episode ${episode}</div>
        
        <div class="error-message">
            ${errorMessage || 'The requested anime episode could not be found on any of our streaming sources.'}
        </div>
        
        <div class="suggestions">
            <h3>💡 Suggestions:</h3>
            <ul>
                <li>Check if the anime title is spelled correctly</li>
                <li>Try a different episode number</li>
                <li>The anime might not be available in your region</li>
                <li>Try again later as sources get updated regularly</li>
                ${anilistId ? `<li>AniList ID: ${anilistId}</li>` : ''}
            </ul>
        </div>
        
        <div class="action-buttons">
            <a href="/" class="btn btn-primary">🏠 Go Home</a>
            <a href="/health" class="btn btn-secondary">📊 Check Status</a>
            <button onclick="history.back()" class="btn btn-secondary">↩️ Go Back</button>
        </div>
        
        <div class="technical-info">
            🔧 Professional Anime Streaming API • If this persists, contact support
        </div>
    </div>

    <script>
        // Add some interactive effects
        document.addEventListener('DOMContentLoaded', function() {
            const buttons = document.querySelectorAll('.btn');
            buttons.forEach(btn => {
                btn.addEventListener('mouseenter', function() {
                    this.style.transform = 'translateY(-2px)';
                });
                btn.addEventListener('mouseleave', function() {
                    this.style.transform = 'translateY(0)';
                });
            });
        });
    </script>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ==================== PROFESSIONAL LOADING SCREEN WITH PROGRESS ====================
function sendEnhancedPlayer(res, title, episode, videoUrl, servers = [], actualSeason = 1, mappingType = 'exact', calculation = '') {
  let mappingMessage = '';
  let calculationInfo = '';

  if (mappingType === 'calculated' || mappingType === 'progressive') {
    mappingMessage = `🎯 Smart Mapping: Season ${actualSeason}, Episode ${actualSeason === 1 ? episode : calculation?.split('=')[1]?.trim() || actualSeason}`;
    calculationInfo = calculation;
  } else if (mappingType === 'fallback') {
    mappingMessage = `🔄 Fallback: Season ${actualSeason}, Episode 1`;
  } else if (actualSeason > 1) {
    mappingMessage = `🎬 Playing from Season ${actualSeason}`;
  }

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
        
        /* Loading Screen Styles */
        .loading-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
        }
        
        .logo {
            font-size: 3.5rem;
            font-weight: bold;
            margin-bottom: 3rem;
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: 0 0 50px rgba(78, 205, 196, 0.7);
            animation: glow 2s ease-in-out infinite alternate;
        }
        
        @keyframes glow {
            from { text-shadow: 0 0 20px rgba(78, 205, 196, 0.7); }
            to { text-shadow: 0 0 30px rgba(78, 205, 196, 1), 0 0 40px rgba(78, 205, 196, 0.5); }
        }
        
        .spinner-container {
            position: relative;
            width: 120px;
            height: 120px;
            margin-bottom: 3rem;
        }
        
        .spinner-outer {
            width: 100%;
            height: 100%;
            border: 4px solid rgba(255, 255, 255, 0.1);
            border-top: 4px solid #4ecdc4;
            border-radius: 50%;
            animation: spin 2s linear infinite;
            position: absolute;
        }
        
        .spinner-middle {
            width: 80px;
            height: 80px;
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-right: 3px solid #ff6b6b;
            border-radius: 50%;
            animation: spinReverse 1.5s linear infinite;
            position: absolute;
            top: 20px;
            left: 20px;
        }
        
        .spinner-inner {
            width: 40px;
            height: 40px;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-bottom: 2px solid #45b7d1;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            position: absolute;
            top: 40px;
            left: 40px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        @keyframes spinReverse {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-360deg); }
        }
        
        .loading-content {
            text-align: center;
            margin-bottom: 2rem;
        }
        
        .loading-text {
            font-size: 1.8rem;
            margin-bottom: 1rem;
            color: #e0e0e0;
            font-weight: 300;
        }
        
        .episode-info {
            font-size: 1.4rem;
            color: #4ecdc4;
            margin-bottom: 2rem;
            font-weight: 600;
        }
        
        .progress-section {
            width: 400px;
            margin: 2rem 0;
        }
        
        .progress-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
            color: #888;
        }
        
        .progress-container {
            width: 100%;
            height: 12px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            overflow: hidden;
            position: relative;
        }
        
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #4ecdc4, #45b7d1, #ff6b6b);
            border-radius: 6px;
            width: 0%;
            transition: width 0.3s ease;
            position: relative;
        }
        
        .progress-bar::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
            animation: shine 2s ease-in-out infinite;
        }
        
        @keyframes shine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        
        .progress-stats {
            display: flex;
            justify-content: space-between;
            margin-top: 1rem;
            font-size: 0.9rem;
            color: #888;
        }
        
        .loading-steps {
            width: 400px;
            margin-top: 2rem;
        }
        
        .step {
            display: flex;
            align-items: center;
            margin-bottom: 1rem;
            opacity: 0.5;
            transition: all 0.3s ease;
        }
        
        .step.active {
            opacity: 1;
        }
        
        .step.completed {
            opacity: 0.8;
        }
        
        .step-icon {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 1rem;
            font-size: 0.8rem;
        }
        
        .step.active .step-icon {
            background: #4ecdc4;
            animation: pulse 1s infinite;
        }
        
        .step.completed .step-icon {
            background: #00ff88;
        }
        
        .step-text {
            flex: 1;
            font-size: 0.9rem;
        }
        
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
        
        .subtitle {
            font-size: 1rem;
            color: #666;
            margin-top: 2rem;
            text-align: center;
            max-width: 500px;
            line-height: 1.5;
        }
        
        .season-info {
            background: rgba(78, 205, 196, 0.2);
            padding: 12px 24px;
            border-radius: 25px;
            margin-top: 2rem;
            font-size: 1rem;
            border: 1px solid rgba(78, 205, 196, 0.4);
            backdrop-filter: blur(10px);
            text-align: center;
        }
        
        .mapping-info {
            background: rgba(255, 107, 107, 0.2);
            padding: 12px 24px;
            border-radius: 25px;
            margin-top: 1rem;
            font-size: 1rem;
            border: 1px solid rgba(255, 107, 107, 0.4);
            backdrop-filter: blur(10px);
            text-align: center;
        }
        
        .calculation {
            font-size: 0.8em;
            opacity: 0.8;
            margin-top: 5px;
        }
        
        /* Player Styles */
        .player-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            display: none;
        }
        
        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        }
        
        .player-info {
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 12px 18px;
            border-radius: 10px;
            z-index: 1000;
            font-size: 14px;
            border: 1px solid rgba(255,255,255,0.2);
            backdrop-filter: blur(15px);
            max-width: 350px;
            transition: opacity 0.3s;
        }
        
        .server-list {
            position: fixed;
            bottom: 25px;
            right: 25px;
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 18px;
            border-radius: 12px;
            z-index: 1000;
            font-size: 13px;
            border: 1px solid rgba(255,255,255,0.2);
            backdrop-filter: blur(15px);
            transition: opacity 0.3s;
        }
        
        .server-item {
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .server-item:last-child {
            border-bottom: none;
        }
        
        .auto-play-notice {
            position: fixed;
            bottom: 15px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: #00ff88;
            padding: 10px 20px;
            border-radius: 25px;
            font-size: 12px;
            z-index: 1000;
            transition: opacity 0.3s;
            border: 1px solid rgba(0,255,136,0.3);
        }
    </style>
</head>
<body>
    <!-- Loading Screen -->
    <div class="loading-container" id="loadingScreen">
        <div class="logo">ANIME STREAM</div>
        
        <div class="spinner-container">
            <div class="spinner-outer"></div>
            <div class="spinner-middle"></div>
            <div class="spinner-inner"></div>
        </div>
        
        <div class="loading-content">
            <div class="loading-text">Preparing Your Stream</div>
            <div class="episode-info">${title} - Episode ${episode}</div>
        </div>
        
        <div class="progress-section">
            <div class="progress-header">
                <span>Loading Progress</span>
                <span id="progressPercent">0%</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" id="progressBar"></div>
            </div>
            <div class="progress-stats">
                <span>Initializing...</span>
                <span id="progressStatus">0% Done</span>
            </div>
        </div>
        
        <div class="loading-steps">
            <div class="step active" id="step1">
                <div class="step-icon">1</div>
                <div class="step-text">Connecting to streaming sources</div>
            </div>
            <div class="step" id="step2">
                <div class="step-icon">2</div>
                <div class="step-text">Fetching episode data</div>
            </div>
            <div class="step" id="step3">
                <div class="step-icon">3</div>
                <div class="step-text">Loading video player</div>
            </div>
            <div class="step" id="step4">
                <div class="step-icon">4</div>
                <div class="step-text">Ready to play</div>
            </div>
        </div>
        
        <div class="subtitle">
            Smart season detection • Ultra-fast loading • Professional streaming experience
        </div>
        
        ${mappingMessage ? `
        <div class="${mappingType === 'fallback' ? 'mapping-info' : 'season-info'}">
            ${mappingMessage}
            ${calculationInfo ? `<div class="calculation">${calculationInfo}</div>` : ''}
        </div>
        ` : ''}
    </div>

    <!-- Player Container -->
    <div class="player-container" id="playerContainer">
        <div class="player-info">
            🎬 ${title} - Episode ${episode} ${actualSeason > 1 ? `(Season ${actualSeason})` : ''}
            ${mappingType !== 'exact' ? `<br><small style="color: #ff6b6b;">${mappingMessage}</small>` : ''}
        </div>
        
        <div class="server-list">
            <div style="margin-bottom: 12px; font-weight: bold; font-size: 14px;">📡 Available Servers:</div>
            ${servers.map((server, index) => 
                `<div class="server-item">${index + 1}. ${server.name} (${server.server})</div>`
            ).join('')}
        </div>
        
        <div class="auto-play-notice">
            🔄 Auto-play enabled • Professional Streaming
        </div>

        <iframe 
            id="videoFrame"
            src="${videoUrl}" 
            allow="autoplay; fullscreen; encrypted-media; accelerometer; gyroscope; picture-in-picture" 
            allowfullscreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            loading="eager">
        </iframe>
    </div>

    <script>
        const loadingScreen = document.getElementById('loadingScreen');
        const playerContainer = document.getElementById('playerContainer');
        const videoFrame = document.getElementById('videoFrame');
        const progressBar = document.getElementById('progressBar');
        const progressPercent = document.getElementById('progressPercent');
        const progressStatus = document.getElementById('progressStatus');
        
        let currentProgress = 0;
        const totalSteps = 4;
        let currentStep = 1;
        
        // Progress simulation with realistic timing
        const progressIntervals = [
            { target: 25, duration: 1500, text: "Connecting to sources..." },
            { target: 50, duration: 2000, text: "Fetching episode data..." },
            { target: 75, duration: 1800, text: "Loading video player..." },
            { target: 95, duration: 1200, text: "Finalizing stream..." },
            { target: 100, duration: 500, text: "Ready!" }
        ];
        
        function updateProgress(target, duration, statusText) {
            return new Promise((resolve) => {
                const start = currentProgress;
                const increment = (target - start) / (duration / 50);
                
                const timer = setInterval(() => {
                    currentProgress += increment;
                    if (currentProgress >= target) {
                        currentProgress = target;
                        clearInterval(timer);
                        resolve();
                    }
                    
                    progressBar.style.width = currentProgress + '%';
                    progressPercent.textContent = Math.round(currentProgress) + '%';
                    progressStatus.textContent = statusText || Math.round(currentProgress) + '% Done';
                    
                }, 50);
            });
        }
        
        function updateStep(stepNumber) {
            // Reset all steps
            for (let i = 1; i <= totalSteps; i++) {
                const step = document.getElementById('step' + i);
                step.classList.remove('active', 'completed');
            }
            
            // Mark previous steps as completed
            for (let i = 1; i < stepNumber; i++) {
                const step = document.getElementById('step' + i);
                step.classList.add('completed');
            }
            
            // Mark current step as active
            if (stepNumber <= totalSteps) {
                const step = document.getElementById('step' + stepNumber);
                step.classList.add('active');
            }
        }
        
        async function simulateLoading() {
            console.log('🚀 Starting loading simulation...');
            
            // Step 1: Initial connection
            updateStep(1);
            await updateProgress(25, 1500, "Connecting to streaming sources...");
            
            // Step 2: Fetching data
            updateStep(2);
            await updateProgress(50, 2000, "Fetching episode data...");
            
            // Step 3: Loading player
            updateStep(3);
            await updateProgress(75, 1800, "Loading video player...");
            
            // Step 4: Finalizing
            updateStep(4);
            await updateProgress(95, 1200, "Finalizing stream...");
            
            // Wait for iframe to load or timeout
            const loadPromise = new Promise((resolve) => {
                videoFrame.onload = resolve;
                videoFrame.onerror = resolve;
            });
            
            // Wait for either iframe load or 2 seconds
            await Promise.race([loadPromise, new Promise(resolve => setTimeout(resolve, 2000))]);
            
            // Final completion
            await updateProgress(100, 500, "Ready to play!");
            
            // Transition to player
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                playerContainer.style.display = 'block';
                console.log('🎉 Stream loaded successfully!');
                
                // Auto-play enhancement
                videoFrame.focus();
                setTimeout(() => {
                    window.focus();
                    try {
                        videoFrame.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                    } catch (e) {
                        console.log('Auto-play command sent');
                    }
                }, 1000);
            }, 1000);
        }
        
        // Start the loading simulation
        simulateLoading().catch(console.error);
        
        // Ultimate fallback - if something goes wrong, show player after 8 seconds
        setTimeout(() => {
            if (loadingScreen.style.display !== 'none') {
                console.log('🔄 Fallback: Showing player after timeout');
                loadingScreen.style.display = 'none';
                playerContainer.style.display = 'block';
            }
        }, 8000);
        
        // Hide controls after 5 seconds
        setTimeout(() => {
            const info = document.querySelector('.player-info');
            const servers = document.querySelector('.server-list');
            const notice = document.querySelector('.auto-play-notice');
            
            if (info) info.style.opacity = '0.3';
            if (servers) servers.style.opacity = '0.3';
            if (notice) notice.style.opacity = '0.5';
        }, 5000);
    </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

function sendCleanIframe(res, url, title = 'Player', episode = 1) {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Episode ${episode}</title>
    <style>
        body,html { margin:0; padding:0; overflow:hidden; background:#000; width:100vw; height:100vh; }
        iframe { width:100%; height:100%; border:none; position:fixed; top:0; left:0; background:#000; }
    </style>
</head>
<body>
    <iframe 
        src="${url}" 
        allow="autoplay; full-screen; encrypted-media" 
        allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="eager">
    </iframe>
    
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const iframe = document.querySelector('iframe');
            iframe?.focus();
        });
    </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ==================== ULTRA-FAST MAIN API ENDPOINTS ====================
app.get('/api/anime/:anilistId/:episode', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { anilistId, episode } = req.params;
    const { json, clean } = req.query;

    console.log(`\n⚡ FAST STREAM: ID ${anilistId} Episode ${episode}`);
    apiStats.totalRequests++;

    const titleData = await getAnimeTitleFromAniList(anilistId);
    console.log(`✅ AniList: "${titleData.primary}"`);
    
    const searchTitle = titleData.primary;
    console.log(`🎯 FAST SEARCH: Episode ${episode} of "${searchTitle}"`);

    const episodeData = await findEpisodeAcrossSeasons(searchTitle, parseInt(episode));

    if (!episodeData) {
      apiStats.failedRequests++;
      const responseTime = Date.now() - startTime;
      
      if (json) {
        return res.status(404).json({ 
          error: 'No anime found on any source',
          anime_title: titleData.primary,
          anilist_id: anilistId,
          episode: parseInt(episode),
          response_time: `${responseTime}ms`,
          sources_tried: SOURCES.map(s => s.name),
          suggestion: 'Episode might not be available yet'
        });
      }
      
      return sendErrorScreen(res, titleData.primary, episode, 
                           `Episode ${episode} not found across multiple seasons.`, anilistId);
    }

    apiStats.successfulRequests++;
    const responseTime = Date.now() - startTime;
    console.log(`⏱️  FAST RESPONSE: ${responseTime}ms`);

    if (clean !== 'false') {
      return sendCleanIframe(res, episodeData.servers[0].url, titleData.primary, episode);
    }

    if (json) {
      return res.json({
        success: true,
        anilist_id: parseInt(anilistId),
        title: titleData.primary,
        requested_episode: parseInt(episode),
        actual_episode: episodeData.actualEpisode,
        actual_season: episodeData.actualSeason,
        mapping_type: episodeData.mappingType,
        calculation: episodeData.calculation || '',
        source: episodeData.source,
        servers: episodeData.servers,
        total_servers: episodeData.servers.length,
        response_time: `${responseTime}ms`
      });
    }

    return sendEnhancedPlayer(res, titleData.primary, episode, 
                            episodeData.servers[0].url, episodeData.servers, 
                            episodeData.actualSeason, episodeData.mappingType, episodeData.calculation);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('💥 AniList endpoint error:', error.message);
    apiStats.failedRequests++;
    
    if (req.query.json) {
      return res.status(500).json({ 
        error: error.message,
        response_time: `${responseTime}ms`,
        suggestion: 'Try different AniList ID or check episode availability'
      });
    }
    
    // Get title for error screen
    let title = 'Unknown Anime';
    try {
      const titleData = await getAnimeTitleFromAniList(req.params.anilistId);
      title = titleData.primary;
    } catch (e) {
      title = `AniList ID: ${req.params.anilistId}`;
    }
    
    return sendErrorScreen(res, title, req.params.episode, error.message, req.params.anilistId);
  }
});

// Ultra-fast stream endpoint
app.get('/api/stream/:name/:episode', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { name, episode } = req.params;
    const { json, clean } = req.query;

    console.log(`\n🎬 FAST STREAM: ${name} Episode ${episode}`);
    apiStats.totalRequests++;

    const episodeData = await findEpisodeAcrossSeasons(name, parseInt(episode));

    if (!episodeData) {
      apiStats.failedRequests++;
      const responseTime = Date.now() - startTime;
      
      if (json) {
        return res.status(404).json({ 
          error: 'No streaming sources found',
          searched_name: name,
          episode: parseInt(episode),
          response_time: `${responseTime}ms`,
          sources_tried: SOURCES.map(s => s.name),
          suggestion: 'Try alternative titles or check if anime exists on sources'
        });
      }
      
      return sendErrorScreen(res, name, episode, 
                           `"${name}" - Episode ${episode} not found on any streaming sources.`);
    }

    apiStats.successfulRequests++;
    const responseTime = Date.now() - startTime;
    console.log(`⏱️  FAST RESPONSE: ${responseTime}ms`);

    if (clean !== 'false') {
      return sendCleanIframe(res, episodeData.servers[0].url, name, episode);
    }

    if (json) {
      return res.json({
        success: true,
        title: name,
        requested_episode: parseInt(episode),
        actual_episode: episodeData.actualEpisode,
        actual_season: episodeData.actualSeason,
        mapping_type: episodeData.mappingType,
        calculation: episodeData.calculation || '',
        source: episodeData.source,
        servers: episodeData.servers,
        response_time: `${responseTime}ms`
      });
    }

    return sendEnhancedPlayer(res, name, episode, 
                            episodeData.servers[0].url, episodeData.servers,
                            episodeData.actualSeason, episodeData.mappingType, episodeData.calculation);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('💥 Stream error:', error.message);
    apiStats.failedRequests++;
    
    if (req.query.json) {
      return res.status(500).json({ 
        error: error.message,
        response_time: `${responseTime}ms`,
        searched_name: req.params.name,
        episode: parseInt(req.params.episode)
      });
    }
    
    return sendErrorScreen(res, req.params.name, req.params.episode, error.message);
  }
});

// ==================== KEEP OLD ENDPOINTS FOR COMPATIBILITY ====================
app.get('/api/anime/:anilistId/:season/:episode', async (req, res) => {
  const { anilistId, episode } = req.params;
  res.redirect(`/api/anime/${anilistId}/${episode}`);
});

app.get('/api/stream/:name/:season/:episode', async (req, res) => {
  const { name, episode } = req.params;
  res.redirect(`/api/stream/${name}/${episode}`);
});

// ==================== HEALTH & STATUS ====================
app.get('/health', (req, res) => {
  const successRate = apiStats.totalRequests > 0 ? 
    Math.round((apiStats.successfulRequests / apiStats.totalRequests) * 100) : 0;
    
  res.json({ 
    status: 'active', 
    version: '5.0.0',
    performance: 'PROFESSIONAL ERROR HANDLING',
    total_requests: apiStats.totalRequests,
    successful_requests: apiStats.successfulRequests,
    failed_requests: apiStats.failedRequests,
    anilist_requests: apiStats.anilistRequests,
    success_rate: successRate + '%',
    sources: SOURCES.map(s => s.name),
    strategy: 'Professional error UI with suggestions',
    features: [
      'Professional error screen with gradient design',
      'Interactive suggestions for users',
      'Beautiful loading animations',
      'Auto-redirect and action buttons'
    ]
  });
});

app.get('/', (req, res) => res.json({ 
  message: '⚡ PROFESSIONAL ANIME STREAMING API',
  version: '5.0.0',
  performance: 'Professional error handling',
  sources: ['satoru.one', 'watchanimeworld.in', 'animeworld-india.me'],
  strategy: 'Smart multi-season mapping • Professional UI/UX',
  endpoints: {
    '/api/anime/:anilistId/:episode': 'AniList streaming (professional UI)',
    '/api/stream/:name/:episode': 'Name-based streaming (professional UI)',
    '/health': 'API status with performance metrics'
  },
  features: [
    'Professional loading screen with progress',
    'Beautiful error screen with suggestions',
    'Smart season detection',
    'Auto-calculation for episode mapping'
  ]
}));

// ==================== SERVER STARTUP ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
⚡ PROFESSIONAL ANIME API v5.0 - ERROR HANDLING
───────────────────────────────────────────
Port: ${PORT}
API: http://localhost:${PORT}

🎨 PROFESSIONAL UI:
• Beautiful error screens with gradient design
• Professional loading animations  
• Interactive suggestions for users
• Action buttons and navigation

🚀 ERROR FEATURES:
• Gradient background error screens
• Animated error icons
• Helpful suggestions list
• Action buttons (Home, Status, Back)
• Technical information display

🔧 LOADING FEATURES:
• Triple spinner animation
• Progress bar with shine effect
• Step-by-step loading indicators
• Professional typography

✅ READY: Professional error handling active
───────────────────────────────────────────
  `);
});
