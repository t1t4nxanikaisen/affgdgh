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

// ==================== STEP 2: TRY WATCHANIMEWORLD.IN ====================
async function tryWatchAnimeWorld(animeTitle, episode) {
  try {
    console.log(`🔍 Trying watchanimeworld.in: ${animeTitle} Episode ${episode}`);
    
    // Clean title for URL
    const cleanTitle = animeTitle.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
    
    // Try seasons 1-5 with the exact pattern you specified
    for (let season = 1; season <= 5; season++) {
      const url = `https://watchanimeworld.in/episode/${cleanTitle}-${season}x${episode}`;
      console.log(`🔗 Trying: ${url}`);
      
      try {
        const response = await axios.get(url, {
          headers: getHeaders(),
          timeout: 8000,
          validateStatus: null
        });

        if (response.status === 200 && !response.data.includes('404')) {
          const $ = load(response.data);
          const servers = extractServers($, 'https://watchanimeworld.in');
          
          if (servers.length > 0) {
            console.log(`✅ Found on watchanimeworld.in - Season ${season}`);
            return {
              url: servers[0].url,
              servers: servers,
              source: 'watchanimeworld.in',
              season: season,
              episode: episode,
              valid: true
            };
          }
        }
      } catch (error) {
        // Continue to next season
      }
    }
    
    throw new Error('Not found on watchanimeworld.in');
  } catch (err) {
    console.error(`💥 watchanimeworld.in error: ${err.message}`);
    throw err;
  }
}

// ==================== STEP 3: TRY ANIMEDUB.CO ====================
async function tryAnimedub(animeTitle, episode) {
  try {
    console.log(`🔍 Trying animedub.co: ${animeTitle} Episode ${episode}`);
    
    // First search for the anime
    const cleanTitle = animeTitle.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = `https://animedub.co/search?query=${encodeURIComponent(cleanTitle)}`;
    
    const searchResponse = await axios.get(searchUrl, {
      headers: getHeaders('https://animedub.co'),
      timeout: 10000
    });

    const $ = load(searchResponse.data);
    let animeUrl = null;
    let bestMatch = null;
    
    // Look for anime in search results
    $('.flw-item, .film-list, .item').slice(0, 5).each((i, el) => {
      const name = $(el).find('.film-name a, .name a, .title a').text().trim();
      const url = $(el).find('a').first().attr('href');
      
      if (name && url && name.toLowerCase().includes(cleanTitle.toLowerCase())) {
        animeUrl = url.startsWith('http') ? url : `https://animedub.co${url}`;
        bestMatch = name;
        return false;
      }
    });

    if (!animeUrl) throw new Error('Anime not found in search results');
    console.log(`✅ Animedub found: "${bestMatch}"`);

    // Extract anime slug from URL for the episode pattern you specified
    const animeSlug = animeUrl.split('/').pop();
    
    // Try the exact pattern you specified: /series/1/Naruto:-Shippuden/episode-number
    const episodeUrl = `https://animedub.co/series/1/${animeSlug}/${episode}`;
    console.log(`🔗 Trying: ${episodeUrl}`);
    
    const episodeResponse = await axios.get(episodeUrl, {
      headers: getHeaders('https://animedub.co'),
      timeout: 10000,
      validateStatus: null
    });

    if (episodeResponse.status === 200 && !episodeResponse.data.includes('404')) {
      const $$ = load(episodeResponse.data);
      const servers = extractServers($$, 'https://animedub.co');
      
      if (servers.length > 0) {
        console.log(`✅ Found on animedub.co`);
        return {
          url: servers[0].url,
          servers: servers,
          source: 'animedub.co',
          season: 1, // Default season for animedub
          episode: episode,
          valid: true
        };
      }
    }
    
    throw new Error('Episode not found on animedub.co');
  } catch (err) {
    console.error(`💥 animedub.co error: ${err.message}`);
    throw err;
  }
}

// ==================== STEP 4: TRY SATORU.ONE (KEEP AS IS) ====================
async function trySatoru(animeTitle, episode) {
  try {
    console.log(`🎯 Satoru: Searching for "${animeTitle}" episode ${episode}`);
    
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

    // Try all servers
    const serverPromises = allServers.map(async (server) => {
      try {
        const sourceUrl = `https://satoru.one/ajax/episode/sources?id=${server.id}`;
        const sourceResponse = await axios.get(sourceUrl, {
          headers: getHeaders('https://satoru.one'),
          timeout: 10000
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
      season: 1, // Satoru uses internal episode numbers
      episode: episode,
      valid: true
    };

  } catch (err) {
    console.error(`💥 Satoru error: ${err.message}`);
    throw err;
  }
}

// ==================== STEP 5: EXTRACT SERVERS FROM PAGES ====================
function extractServers($, baseUrl) {
  const servers = [];
  
  // Extract iframes
  $('iframe').each((i, el) => {
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

  // Extract video sources
  $('video source').each((i, el) => {
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

// ==================== STEP 6: MAIN SEARCH FUNCTION ====================
async function findEpisode(animeTitle, episode) {
  console.log(`\n🎯 STARTING SEARCH: "${animeTitle}" Episode ${episode}`);
  
  // Try sources in order
  const sources = [
    { name: 'satoru.one', func: trySatoru },
    { name: 'watchanimeworld.in', func: tryWatchAnimeWorld },
    { name: 'animedub.co', func: tryAnimedub }
  ];
  
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

// ==================== HELPER FUNCTIONS ====================
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

function detectServerType(urlOrName) {
  const text = (urlOrName || '').toLowerCase();
  if (text.includes('streamtape')) return 'StreamTape';
  if (text.includes('dood')) return 'DoodStream';
  if (text.includes('filemoon')) return 'FileMoon';
  if (text.includes('mp4upload')) return 'Mp4Upload';
  if (text.includes('vidstream')) return 'VidStream';
  if (text.includes('voe')) return 'Voe';
  if (text.includes('satoru')) return 'Satoru';
  if (text.includes('animedub')) return 'Animedub';
  return 'Direct';
}

function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return baseUrl + url;
  if (url.startsWith('http')) return url;
  return baseUrl + url;
}

// ==================== SIMPLE LOADING SCREEN ====================
function sendEnhancedPlayer(res, title, episode, videoUrl, servers = [], source = 'unknown') {
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
            display: none;
        }
        
        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        }
        
        /* Server overlay */
        .server-overlay {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 15px;
            border-radius: 10px;
            z-index: 1000;
            border: 1px solid rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
            max-width: 300px;
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
        
        .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            padding: 5px;
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
        
        /* Toggle button */
        .toggle-servers {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 8px 12px;
            border-radius: 5px;
            cursor: pointer;
            z-index: 999;
            font-size: 12px;
            backdrop-filter: blur(10px);
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
    </style>
</head>
<body>
    <!-- Loading Screen -->
    <div class="loading-screen" id="loadingScreen">
        <div class="spinner"></div>
        <div class="loading-text">Loading...</div>
    </div>

    <!-- Player Container -->
    <div class="player-container" id="playerContainer">
        <div class="source-info">
            ${title} | Episode ${episode}
        </div>
        
        <button class="toggle-servers" onclick="toggleServerOverlay()">
            🔄 Servers (${servers.length})
        </button>
        
        <div class="server-overlay" id="serverOverlay" style="display: none;">
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
            loading="eager">
        </iframe>
    </div>

    <script>
        const loadingScreen = document.getElementById('loadingScreen');
        const playerContainer = document.getElementById('playerContainer');
        const videoFrame = document.getElementById('videoFrame');
        
        let currentServer = '${videoUrl}';
        
        // Wait for iframe to load, then hide loading screen
        videoFrame.onload = function() {
            console.log('✅ Video loaded, hiding loading screen');
            loadingScreen.classList.add('hidden');
            playerContainer.style.display = 'block';
        };
        
        // Fallback - hide loading after 5 seconds
        setTimeout(() => {
            if (!loadingScreen.classList.contains('hidden')) {
                console.log('🔄 Fallback: Hiding loading screen');
                loadingScreen.classList.add('hidden');
                playerContainer.style.display = 'block';
            }
        }, 5000);
        
        // Server switching functions
        function toggleServerOverlay() {
            const overlay = document.getElementById('serverOverlay');
            overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
        }
        
        function switchServer(url, element) {
            if (url === currentServer) return;
            
            // Update active server
            document.querySelectorAll('.server-item').forEach(item => {
                item.classList.remove('active');
            });
            element.classList.add('active');
            
            // Switch iframe source
            document.getElementById('videoFrame').src = url;
            currentServer = url;
        }
        
        // Auto-hide overlay after 8 seconds
        setTimeout(() => {
            const overlay = document.getElementById('serverOverlay');
            if (overlay.style.display !== 'none') {
                overlay.style.display = 'none';
            }
        }, 8000);
        
        // Hide source info after 5 seconds
        setTimeout(() => {
            document.querySelector('.source-info').style.opacity = '0.5';
        }, 5000);
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
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
    const { json } = req.query;

    console.log(`\n🎯 NEW REQUEST: ID ${anilistId} Episode ${episode}`);
    apiStats.totalRequests++;

    // STEP 1: Get anime title from AniList
    console.log(`📝 STEP 1: Getting title from AniList...`);
    const titleData = await getAnimeTitleFromAniList(anilistId);
    console.log(`✅ Title: "${titleData.primary}"`);

    // STEP 2: Search for episode across sources
    console.log(`🔍 STEP 2: Searching for episode ${episode}...`);
    const episodeData = await findEpisode(titleData.primary, parseInt(episode));

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
        servers: episodeData.servers,
        total_servers: episodeData.servers.length,
        response_time: `${responseTime}ms`
      });
    }

    // Send enhanced player with server switching
    return sendEnhancedPlayer(res, titleData.primary, episode, 
                            episodeData.url, episodeData.servers, episodeData.source);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('💥 Error:', error.message);
    apiStats.failedRequests++;
    res.status(500).json({ error: error.message });
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
      Math.round((apiStats.successfulRequests / apiStats.totalRequests) * 100) + '%' : '0%'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🎯 ANIME STREAMING API
─────────────────────
Port: ${PORT}
API: http://localhost:${PORT}

✅ READY: Simple loading screen active!
─────────────────────
  `);
});
