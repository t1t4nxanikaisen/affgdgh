import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import m3u8Parser from 'm3u8-parser';
import cors from 'cors';

const app = express();
const PORT = 3000;
app.use(cors());

const TMDB_API_KEY = "a2f888b27315e62e471b2d587048f32e";

// -----------------------------
// Enhanced Helpers
// -----------------------------
function slugify(title) {
  const vowelBreakMap = {
    'ā': '-', 'ē': '-', 'ī': '-', 'ō': '-', 'ū': '-',
    'Ā': '-', 'Ē': '-', 'Ī': '-', 'Ō': '-', 'Ū': '-',
  };

  let cleaned = title.split('').map(ch => vowelBreakMap[ch] || ch).join('');

  return cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getTmdbTitle(tmdbId, showType = "TV") {
  if (!tmdbId) throw new Error('No tmdbId');
  try {
    if (showType.toUpperCase() === "MOVIE") {
      const resp = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en`);
      return resp.data.title || resp.data.original_title || null;
    } else {
      const resp = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en`);
      return resp.data.name || resp.data.original_name || null;
    }
  } catch (err) {
    throw new Error(`TMDb title fetch failed: ${err.message}`);
  }
}

function titleVariants(title) {
  const words = title.split(/\s+/);
  const arr = [];
  for (let len = words.length; len >= 2; len--) {
    arr.push(words.slice(0, len).join(' '));
  }
  return arr;
}

function scoreCandidateUniversal(name, originalTitle) {
  const nameL = name.toLowerCase();
  const origL = originalTitle.toLowerCase();

  if (nameL === origL) return 10000;

  const origWords = originalTitle.split(/\s+/).map(w => w.toLowerCase());
  let presentWords = 0;
  origWords.forEach(w => { if (nameL.includes(w)) presentWords++; });

  let score = presentWords * 1000;

  if (nameL.includes(origL)) score += 500;

  const seasonInOrig = origL.match(/season\s*(\d+)/i) || origL.match(/s(\d+)/i);
  const seasonInName = nameL.match(/season\s*(\d+)/i) || nameL.match(/s(\d+)/i);

  if (seasonInOrig && seasonInName) {
    const so = parseInt(seasonInOrig[1]);
    const sn = parseInt(seasonInName[1]);
    if (so === sn) score += 2000;
    else score -= 800 * Math.abs(so-sn);
  }

  if (origL.includes("arc") && nameL.includes("arc")) score += 400;
  if (origL.includes("part") && nameL.includes("part")) score += 400;

  score -= Math.abs(name.length - originalTitle.length);

  return score;
}

// -----------------------------
// Enhanced Headers for watchanimeworld.in
// -----------------------------
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
    'Sec-Fetch-Site': 'cross-site'
  };
}

// -----------------------------
// watchanimeworld.in Scraper (NEW - Tier 2)
// -----------------------------
async function scrapeFromWatchAnimeWorld(hianimeId, episodeId) {
  try {
    console.log(`[🌐 WatchAnimeWorld] Starting scrape for hianimeId=${hianimeId}, episodeId=${episodeId}`);

    // Get anime info first
    const infoUrl = `https://api-anome-three.vercel.app/api/info?id=${hianimeId}`;
    const { data: infoData } = await axios.get(infoUrl, { 
      headers: getEnhancedHeaders(),
      timeout: 15000
    });
    
    if (!infoData.success) throw new Error('Info fetch failed');

    const { tmdbId, showType } = infoData.results.data;
    if (!tmdbId) throw new Error('No tmdbId available');

    const tmdbTitle = await getTmdbTitle(tmdbId, showType);
    if (!tmdbTitle) throw new Error('TMDb title not found');

    const slug = slugify(tmdbTitle);
    console.log(`[🌐 WatchAnimeWorld] Searching for: "${tmdbTitle}" -> ${slug}`);

    // Search on watchanimeworld.in
    const searchUrl = `https://watchanimeworld.in/?s=${encodeURIComponent(tmdbTitle)}`;
    console.log(`[🌐 WatchAnimeWorld] Search URL: ${searchUrl}`);
    
    const { data: searchHtml } = await axios.get(searchUrl, {
      headers: getEnhancedHeaders(),
      timeout: 15000
    });

    const $search = cheerio.load(searchHtml);
    let animeUrl = null;
    let foundTitle = null;

    // Find anime in search results
    $search('.item, .post, article, .anime-card').each((i, el) => {
      const $el = $search(el);
      const title = $el.find('h2, h3, .title, a').first().text().trim();
      const url = $el.find('a').first().attr('href');
      
      if (title && url) {
        const titleLower = title.toLowerCase();
        const searchLower = tmdbTitle.toLowerCase();
        
        if (titleLower.includes(searchLower) || searchLower.includes(titleLower)) {
          animeUrl = url;
          foundTitle = title;
          console.log(`[🌐 WatchAnimeWorld] ✅ Found: "${title}" -> ${url}`);
          return false;
        }
      }
    });

    if (!animeUrl) {
      throw new Error(`Anime "${tmdbTitle}" not found on watchanimeworld.in`);
    }

    // Get episodes from the anime page
    console.log(`[🌐 WatchAnimeWorld] Fetching anime page: ${animeUrl}`);
    const { data: animeHtml } = await axios.get(animeUrl, {
      headers: getEnhancedHeaders(),
      timeout: 15000
    });

    const $anime = cheerio.load(animeHtml);
    
    // Extract episode URLs
    const episodeUrls = [];
    $anime('a').each((i, el) => {
      const href = $anime(el).attr('href');
      const text = $anime(el).text().trim();
      
      if (href && href.includes('/episode/') && text.toLowerCase().includes('episode')) {
        episodeUrls.push({
          url: href,
          text: text
        });
      }
    });

    console.log(`[🌐 WatchAnimeWorld] Found ${episodeUrls.length} episode links`);

    // Find the specific episode
    let targetEpisodeUrl = null;
    const episodeNum = parseInt(episodeId);
    
    for (const ep of episodeUrls) {
      const epMatch = ep.text.match(/episode\s*(\d+)/i) || ep.text.match(/\s(\d+)$/);
      if (epMatch && parseInt(epMatch[1]) === episodeNum) {
        targetEpisodeUrl = ep.url;
        console.log(`[🌐 WatchAnimeWorld] ✅ Found episode ${episodeNum}: ${targetEpisodeUrl}`);
        break;
      }
    }

    if (!targetEpisodeUrl && episodeUrls.length > 0) {
      // Fallback: use first episode if specific episode not found
      targetEpisodeUrl = episodeUrls[0].url;
      console.log(`[🌐 WatchAnimeWorld] ⚠️ Using first episode as fallback: ${targetEpisodeUrl}`);
    }

    if (!targetEpisodeUrl) {
      throw new Error(`Episode ${episodeNum} not found on watchanimeworld.in`);
    }

    // Extract iframe from episode page
    console.log(`[🌐 WatchAnimeWorld] Fetching episode: ${targetEpisodeUrl}`);
    const { data: episodeHtml } = await axios.get(targetEpisodeUrl, {
      headers: getEnhancedHeaders(),
      timeout: 15000
    });

    const $episode = cheerio.load(episodeHtml);
    
    // Multiple iframe extraction methods
    let iframeUrl = null;
    
    // Method 1: Direct iframe
    iframeUrl = $episode('iframe').attr('src') || 
                $episode('iframe').attr('data-src') ||
                $episode('[data-src*="//"]').attr('data-src');

    // Method 2: Video element
    if (!iframeUrl) {
      iframeUrl = $episode('video').attr('src') || 
                  $episode('video source').attr('src');
    }

    // Method 3: Script extraction
    if (!iframeUrl) {
      const scripts = $episode('script').toString();
      const patterns = [
        /src\s*=\s*["']([^"']*\.(mp4|m3u8|webm)[^"']*)["']/gi,
        /file\s*:\s*["']([^"']*)["']/gi,
        /source\s*:\s*["']([^"']*)["']/gi,
        /iframe.*?src=["']([^"']+)["']/gi
      ];

      for (const pattern of patterns) {
        const match = scripts.match(pattern);
        if (match && match[1]) {
          iframeUrl = match[1];
          break;
        }
      }
    }

    if (!iframeUrl) {
      throw new Error('No iframe/video source found on episode page');
    }

    // Normalize URL
    if (iframeUrl.startsWith('//')) {
      iframeUrl = 'https:' + iframeUrl;
    } else if (iframeUrl.startsWith('/')) {
      const urlObj = new URL(targetEpisodeUrl);
      iframeUrl = urlObj.origin + iframeUrl;
    }

    console.log(`[🌐 WatchAnimeWorld] ✅ Extracted iframe: ${iframeUrl}`);

    return {
      source: 'watchanimeworld',
      title: tmdbTitle,
      showType: showType,
      episode: episodeNum,
      episode_id: episodeId,
      sources: [{
        quality: 'auto',
        url: iframeUrl,
        type: 'iframe'
      }]
    };

  } catch (err) {
    console.error(`[🌐 WatchAnimeWorld] ❌ Scraper failed: ${err.message}`);
    throw new Error(`WatchAnimeWorld: ${err.message}`);
  }
}

// -----------------------------
// Satoru Helpers (Tier 1 - Existing)
// -----------------------------
async function getAnimeTitleAndType(apiUrl) {
  try {
    const { data } = await axios.get(apiUrl);
    if (!data.success) throw new Error('Anime info not found');
    return {
      title: data.results.data.title
        .replace(/[^\w\s-]/gi, '')
        .replace(/\s+/g, ' ')
        .trim(),
      showType: data.results.data.showType ? data.results.data.showType.trim().toUpperCase() : null,
      tmdbId: data.results.data.tmdbId || null,
    };
  } catch (err) {
    throw new Error(`[getAnimeTitleAndType] ${err.message} (url: ${apiUrl})`);
  }
}

async function getEpisodeNumberFromId(hianimeId, episodeId) {
  try {
    const apiUrl = `https://api-anome-three.vercel.app/api/episodes/id=${hianimeId}`;
    const { data } = await axios.get(apiUrl);
    if (!data.success) throw new Error('Episodes data not found');

    const episode = data.results.episodes.find(ep => ep.episode_id === episodeId);
    if (!episode) throw new Error(`Episode ID ${episodeId} not found in episodes list`);

    console.log(`[⚙️ Satoru] Found episode ${episode.episode_no}: ${episode.title} (ID: ${episodeId})`);
    return episode.episode_no;
  } catch (err) {
    throw new Error(`[getEpisodeNumberFromId] ${err.message} (hianimeId: ${hianimeId}, episodeId: ${episodeId})`);
  }
}

async function searchSatoruAll(keyword, originalTitle) {
  try {
    const url = `https://satoru.one/filter?keyword=${encodeURIComponent(keyword)}`;
    const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(html);
    let results = [];
    $('.flw-item').each((i, el) => {
      const name = $(el).find('.film-name a').text().trim();
      const dataId = $(el).find('.film-poster-ahref').attr('data-id');
      const showType = $(el).find('.fd-infor .fdi-item').first().text().trim().toUpperCase();
      if (dataId && name) {
        let score = scoreCandidateUniversal(name, originalTitle);
        results.push({ id: dataId, displayName: name, score, showType });
      }
    });
    return results;
  } catch (err) {
    console.warn(`[⚙️ Satoru searchSatoruAll] Failed: ${err.message}`);
    return [];
  }
}

async function searchSatoruMultiBest(title, expectedShowType) {
  const variants = titleVariants(title);
  let allCandidates = [];
  for (const variant of variants) {
    console.log(`[⚙️ Satoru] Trying variant "${variant}"...`);
    const candidates = await searchSatoruAll(variant, title);
    allCandidates = allCandidates.concat(candidates);
  }
  if (!allCandidates.length) throw new Error(`No anime candidates found for any variant: ${variants.join(' | ')}`);

  let filtered = allCandidates;
  if (expectedShowType) {
    filtered = allCandidates.filter(x => x.showType === expectedShowType.toUpperCase());
    if (!filtered.length) throw new Error(`No anime found of required showType ${expectedShowType}`);
  }

  filtered.sort((a, b) => b.score - a.score);

  console.log('[⚙️ Satoru] Matches:');
  filtered.forEach(x => console.log(`- ${x.displayName} (${x.showType}, ID: ${x.id}) score=${x.score}`));

  return filtered[0].id;
}

async function getEpisodeList(animeId, episodeNum) {
  try {
    const url = `https://satoru.one/ajax/episode/list/${animeId}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(data.html);

    let epId = null;
    let foundEpisodeNums = [];
    $('.ep-item').each((i, el) => {
      const num = $(el).attr('data-number');
      const id = $(el).attr('data-id');
      foundEpisodeNums.push(num);
      if (String(num) === String(episodeNum)) epId = id;
    });

    console.log(`[⚙️ Satoru] animeId=${animeId}, found episodes=[${foundEpisodeNums.join(', ')}], requested=${episodeNum}`);

    if (!epId) throw new Error(`Episode not found. Available episode numbers: [${foundEpisodeNums.join(', ')}], requested: ${episodeNum}`);
    return epId;
  } catch (err) {
    throw new Error(`[getEpisodeList] ${err.message} (animeId: ${animeId}, episodeNum: ${episodeNum})`);
  }
}

async function getServerAndSourceId(epId) {
  try {
    const url = `https://satoru.one/ajax/episode/servers?episodeId=${epId}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

    let intro = null, outro = null;
    if (data.status && data.skip) {
      data.skip.forEach(k => {
        if (k.skip_type === 'op') intro = { start: k.start_time, end: k.end_time };
        if (k.skip_type === 'ed') outro = { start: k.start_time, end: k.end_time };
      });
    }

    const $ = cheerio.load(data.html);
    const serverSourceId = $('.server-item').first().attr('data-id');
    if (!serverSourceId) throw new Error('No server source found');
    return { intro, outro, serverSourceId };
  } catch (err) {
    throw new Error(`[getServerAndSourceId] ${err.message} (epId: ${epId})`);
  }
}

async function getSources(serverSourceId) {
  try {
    const url = `https://satoru.one/ajax/episode/sources?id=${serverSourceId}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (data.type !== 'iframe') throw new Error('No iframe source');
    return data.link;
  } catch (err) {
    throw new Error(`[getSources] ${err.message} (serverSourceId: ${serverSourceId})`);
  }
}

async function scrapeFromSatoru(hianimeId, episodeId) {
  try {
    console.log(`[⚙️ Satoru] Starting scrape for hianimeId=${hianimeId}, episodeId=${episodeId}`);
    const infoUrl = `https://api-anome-three.vercel.app/api/info?id=${hianimeId}`;
    const { title, showType } = await getAnimeTitleAndType(infoUrl);
    console.log(`[⚙️ Satoru] title=${title}, showType=${showType}`);

    const episodeNum = await getEpisodeNumberFromId(hianimeId, episodeId);
    const satoruId = await searchSatoruMultiBest(title, showType);
    const epId = await getEpisodeList(satoruId, episodeNum);
    const { intro, outro, serverSourceId } = await getServerAndSourceId(epId);
    const iframeUrl = await getSources(serverSourceId);

    return {
      source: 'satoru',
      title,
      showType,
      episode: episodeNum,
      episode_id: episodeId,
      intro,
      outro,
      sources: [{
        quality: 'auto',
        url: iframeUrl,
        type: 'iframe'
      }]
    };
  } catch (err) {
    throw new Error(`[⚙️ Satoru] ${err.message}`);
  }
}

// -----------------------------
// AnimeWorld Scraper (Tier 3 - Existing)
// -----------------------------
async function scrapeFromAnimeWorld(hianimeId, episodeId) {
  try {
    console.log(`[🌸 AnimeWorld] Starting scrape for hianimeId=${hianimeId}, episodeId=${episodeId}`);

    // --- Fetch info ---
    const infoUrl = `https://api-anome-three.vercel.app/api/info?id=${hianimeId}`;
    const { data: infoData } = await axios.get(infoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!infoData.success) throw new Error('Info fetch failed');

    const { tmdbId, showType, anilistId } = infoData.results.data;
    if (!tmdbId) throw new Error('No tmdbId for fallback!');

    const tmdbTitle = await getTmdbTitle(tmdbId, showType);
    if (!tmdbTitle) throw new Error('TMDb title not found');

    const slug = slugify(tmdbTitle);
    console.log(`[🌸 AnimeWorld] tmdbTitle=${tmdbTitle}, showType=${showType}, slug=${slug}`);

    // --- MOVIE logic ---
    if (showType && showType.toUpperCase() === 'MOVIE') {
      const movieUrl = `https://animeworld-india.me/movies/${slug}`;
      console.log(`[🌸 AnimeWorld] Movie URL: ${movieUrl}`);
      const { data: movieHtml } = await axios.get(movieUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const $ = cheerio.load(movieHtml);

      const iframe =
        $('#options-0 iframe').attr('data-src') ||
        $('#options-0 iframe').attr('src') ||
        $('iframe').first().attr('data-src') ||
        $('iframe').first().attr('src');
      if (!iframe) throw new Error('No iframe found on movie page');

      console.log(`[🌸 AnimeWorld] Movie iframe found: ${iframe}`);
      
      return {
        source: 'animeworld',
        fallback_reason: null,
        tmdbTitle,
        showType,
        episode: 1,
        episode_id: episodeId,
        sources: [{
          quality: 'auto',
          url: iframe,
          type: 'iframe'
        }]
      };
    }

    // --- SERIES logic ---
    const seriesUrl = `https://animeworld-india.me/series/${slug}`;
    console.log(`[🌸 AnimeWorld] Series URL: ${seriesUrl}`);
    const { data: seriesHtml } = await axios.get(seriesUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(seriesHtml);

    // --- Extract all seasons dynamically ---
    const seasonElements = $('ul.aa-cnt.sub-menu li a');
    const seasons = [];
    seasonElements.each((i, el) => {
      const seasonNum = parseInt($(el).attr('data-season'), 10);
      const post = $(el).attr('data-post');
      const aslug = $(el).attr('data-aslug');
      if (seasonNum && post && aslug) seasons.push({ seasonNum, post, aslug });
    });
    if (seasons.length === 0) throw new Error('No seasons found in HTML');

    console.log(`[🌸 AnimeWorld] ✅ Found ${seasons.length} seasons`);

    // --- Fetch episodes from API ---
    const episodesApiUrl = `https://api-anome-three.vercel.app/api/episodes/id=${hianimeId}`;
    const { data: episodesData } = await axios.get(episodesApiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!episodesData.success) throw new Error('Episodes fetch failed (AnimeWorld)');
    const requestedEpisode = episodesData.results.episodes.find((e) => e.episode_id === episodeId);
    if (!requestedEpisode) throw new Error('Episode ID not found in episodes list (AnimeWorld)');
    const episode_no = requestedEpisode.episode_no;

    // --- Find the correct episode URL ---
    let episodeUrl = null;

    for (const { seasonNum, post, aslug } of seasons) {
      try {
        console.log(`[🌸 AnimeWorld] Checking Season ${seasonNum}...`);

        const postData = new URLSearchParams({
          action: 'action_select_season',
          season: String(seasonNum),
          post: String(post),
          aslug: String(aslug),
        });

        const { data: seasonHtml } = await axios.post('https://animeworld-india.me/ajax/ajax.php', postData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: seriesUrl,
            Origin: 'https://animeworld-india.me',
            'User-Agent': 'Mozilla/5.0',
          },
          validateStatus: () => true,
        });

        const $season = cheerio.load(seasonHtml);
        const episodeElements = $season('li article.post');
        
        for (let i = 0; i < episodeElements.length; i++) {
          const epEl = episodeElements.eq(i);
          const epNumText = epEl.find('.num-epi').text().trim();
          const match = epNumText.match(/x(\d+)/);
          const epNum = match ? parseInt(match[1]) : i + 1;
          
          if (epNum === episode_no) {
            episodeUrl = epEl.find('a.lnk-blk').attr('href');
            console.log(`[🌸 AnimeWorld] ✅ Found episode URL: ${episodeUrl}`);
            break;
          }
        }
        
        if (episodeUrl) break;
      } catch (err) {
        console.warn(`[🌸 AnimeWorld] Season ${seasonNum} failed: ${err.message}`);
        continue;
      }
    }

    if (!episodeUrl) throw new Error('Episode URL not found across all seasons');

    // --- Fetch episode page and extract iframe ---
    const { data: episodeHtml } = await axios.get(episodeUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ep = cheerio.load(episodeHtml);

    const iframe =
      $ep('#options-0 iframe').attr('data-src') ||
      $ep('#options-0 iframe').attr('src') ||
      $ep('iframe').first().attr('data-src') ||
      $ep('iframe').first().attr('src');
    if (!iframe) throw new Error('No iframe found in episode page');
    console.log(`[🌸 AnimeWorld] Episode iframe: ${iframe}`);

    return {
      source: 'animeworld',
      fallback_reason: null,
      tmdbTitle,
      showType,
      episode: episode_no,
      episode_id: episodeId,
      sources: [{
        quality: 'auto',
        url: iframe,
        type: 'iframe'
      }]
    };
  } catch (err) {
    console.error(`[🌸 AnimeWorld] ❌ Scraper failed: ${err.message}`);
    throw err;
  }
}

// -----------------------------
// Three-Tier Fallback System
// -----------------------------
async function scrapeAll(hianimeId, episodeId) {
  const sources = [
    { name: 'Satoru', scraper: scrapeFromSatoru },
    { name: 'WatchAnimeWorld', scraper: scrapeFromWatchAnimeWorld },
    { name: 'AnimeWorld', scraper: scrapeFromAnimeWorld }
  ];

  let lastError = null;
  
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    try {
      console.log(`\n[${i + 1}️⃣ ${source.name}] Attempting scrape...`);
      const result = await source.scraper(hianimeId, episodeId);
      
      if (i > 0) {
        result.fallback_reason = `Previous sources failed: ${lastError}`;
        result.fallback_chain = sources.slice(0, i).map(s => s.name);
      }
      
      console.log(`[✅ SUCCESS] ${source.name} worked!`);
      return result;
      
    } catch (err) {
      console.log(`[❌ FAILED] ${source.name}: ${err.message}`);
      lastError = `${source.name}: ${err.message}`;
      
      // Continue to next source
      if (i < sources.length - 1) {
        console.log(`[🔄 FALLBACK] Trying next source...`);
      }
    }
  }

  throw new Error(`All sources failed: ${lastError}`);
}

// -----------------------------
// Express endpoints
// -----------------------------
app.get('/api/servers/:hianime_id', async (req, res) => {
  try {
    const { hianime_id } = req.params;
    const { ep: episode_id } = req.query;
    if (!episode_id) return res.status(400).json({ error: 'Episode ID (ep) query parameter is required' });

    const servers = [
      {
        type: "mult",
        data_id: episode_id,
        server_id: 1,
        serverName: "Satoru"
      },
      {
        type: "mult",
        data_id: episode_id,
        server_id: 2,
        serverName: "WatchAnimeWorld"
      },
      {
        type: "mult",
        data_id: episode_id,
        server_id: 3,
        serverName: "AnimeWorld"
      }
    ];

    res.json({ success: true, results: servers });
  } catch (err) {
    console.error(`[API /api/servers] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stream/:hianime_id', async (req, res) => {
  try {
    const { hianime_id } = req.params;
    const { ep: episode_id } = req.query;
    if (!episode_id) return res.status(400).json({ error: 'Episode ID (ep) query parameter is required' });

    const result = await scrapeAll(hianime_id, episode_id);
    res.json(result);
  } catch (err) {
    console.error(`[API /api/stream] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------
// Enhanced Player Endpoint
// -----------------------------
app.get('/api/player/:hianime_id', async (req, res) => {
  try {
    const { hianime_id } = req.params;
    const { ep: episode_id } = req.query;
    
    if (!episode_id) {
      return res.status(400).json({ error: 'Episode ID (ep) query parameter is required' });
    }

    const result = await scrapeAll(hianime_id, episode_id);
    const iframeUrl = result.sources[0].url;
    const title = result.tmdbTitle || result.title;
    const episode = result.episode;
    const source = result.source;
    const fallbackReason = result.fallback_reason;

    const html = `<!DOCTYPE html>
<html lang="en">
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
        .player-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            display: flex;
            flex-direction: column;
        }
        .player-header {
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #333;
            z-index: 1000;
        }
        .player-title {
            font-size: 18px;
            font-weight: bold;
            color: #667eea;
        }
        .player-source {
            font-size: 12px;
            color: #ccc;
            background: #333;
            padding: 5px 10px;
            border-radius: 15px;
        }
        .fallback-notice {
            background: #ff6b6b;
            color: white;
            padding: 10px;
            text-align: center;
            font-size: 12px;
        }
        .iframe-container {
            flex: 1;
            position: relative;
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        }
        .loading-message {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 16px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="player-container">
        ${fallbackReason ? `
        <div class="fallback-notice">
            ⚠️ Using fallback source: ${fallbackReason}
        </div>
        ` : ''}
        
        <div class="player-header">
            <div class="player-title">🎬 ${title} - Episode ${episode}</div>
            <div class="player-source">Source: ${source}</div>
        </div>
        
        <div class="iframe-container">
            <div class="loading-message" id="loadingMessage">
                ⏳ Loading player from ${source}...
            </div>
            <iframe 
                src="${iframeUrl}" 
                id="videoFrame"
                allow="autoplay; fullscreen; encrypted-media; accelerometer; gyroscope; picture-in-picture" 
                allowfullscreen
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                loading="eager"
                onload="document.getElementById('loadingMessage').style.display = 'none';"
                onerror="document.getElementById('loadingMessage').innerHTML = '❌ Failed to load from ${source}. Please try another server.';">
            </iframe>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const iframe = document.getElementById('videoFrame');
            iframe?.focus();
            
            // Auto-hide header after 5 seconds
            setTimeout(() => {
                const header = document.querySelector('.player-header');
                if (header) header.style.opacity = '0.3';
            }, 5000);
            
            // Show header on mouse move
            document.addEventListener('mousemove', function() {
                const header = document.querySelector('.player-header');
                if (header) header.style.opacity = '1';
                
                clearTimeout(window.headerTimeout);
                window.headerTimeout = setTimeout(() => {
                    if (header) header.style.opacity = '0.3';
                }, 3000);
            });
        });
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error(`[API /api/player] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.json({
  message: 'Three-Tier Anime Streaming API 🚀',
  sources: [
    'Satoru.one (Primary)',
    'WatchAnimeWorld.in (Secondary)', 
    'AnimeWorld (Tertiary)'
  ],
  endpoints: {
    '/api/stream/:hianime_id?ep=:episode_id': 'Get streaming data',
    '/api/player/:hianime_id?ep=:episode_id': 'Enhanced player with fallbacks',
    '/api/servers/:hianime_id?ep=:episode_id': 'Get available servers'
  },
  example: '/api/player/100?ep=1'
}));

app.listen(PORT, () => {
  console.log(`
🎬 THREE-TIER ANIME STREAMING API
─────────────────────────────────
📍 Port: ${PORT}
🌐 API: http://localhost:${PORT}

🎯 SOURCES (PRIORITY ORDER):
1. Satoru.one - Primary (Fastest)
2. WatchAnimeWorld.in - Secondary (Enhanced extraction)  
3. AnimeWorld - Tertiary (Fallback)

⚡ FEATURES:
• Three-tier fallback system
• Enhanced iframe extraction
• Smart error recovery
• Auto-source switching

📚 ENDPOINTS:
• /api/stream/:id?ep=:ep - Streaming data
• /api/player/:id?ep=:ep - Enhanced player
• /api/servers/:id?ep=:ep - Available servers

✅ API is ready with enhanced reliability!
─────────────────────────────────
  `);
});
