const axios = require('axios');
const NodeCache = require('node-cache');

// Caché: 1 hora para datos generales, 30 min para temporadas
const bridgeCache = new NodeCache({ stdTTL: 3600 });

module.exports = function(app) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.salacine.app"; 

    // Obtener datos generales
    async function getTmdbData(id, type) {
        const cacheKey = `bridge_${type}_${id}`;
        const cached = bridgeCache.get(cacheKey);
        if (cached) return cached;

        try {
            // Pedimos recomendaciones y proveedores en la misma llamada
            const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=es-MX&append_to_response=credits,videos,images,watch/providers,recommendations`;
            const response = await axios.get(url);
            bridgeCache.set(cacheKey, response.data);
            return response.data;
        } catch (error) {
            console.error(`[Bridge] Error TMDB Main ${id}:`, error.message);
            return null;
        }
    }

    // Nueva función: Obtener episodios de una temporada específica
    async function getSeasonData(tvId, seasonNumber) {
        const cacheKey = `bridge_season_${tvId}_${seasonNumber}`;
        const cached = bridgeCache.get(cacheKey);
        if (cached) return cached;

        try {
            const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-MX`;
            const response = await axios.get(url);
            bridgeCache.set(cacheKey, response.data, 1800); // Cache 30 min
            return response.data;
        } catch (error) {
            return null;
        }
    }

    app.get('/view/:type/:id', async (req, res) => {
        const { type, id } = req.params;
        
        if (type !== 'movie' && type !== 'tv') return res.status(404).send('Tipo inválido');

        // 1. Carga Datos Principales
        const data = await getTmdbData(id, type);
        if (!data) return res.status(404).send('Contenido no encontrado');

        // 2. Si es SERIE, cargamos la Temporada 1 (o la primera disponible) para mostrar episodios
        let episodes = [];
        if (type === 'tv' && data.seasons && data.seasons.length > 0) {
            // Buscamos la primera temporada que no sea la "Specials" (temporada 0) si es posible
            const firstSeason = data.seasons.find(s => s.season_number === 1) || data.seasons[0];
            const seasonData = await getSeasonData(id, firstSeason.season_number);
            if (seasonData) episodes = seasonData.episodes;
        }

        // === PROCESAMIENTO ===
        const title = data.title || data.name;
        const overview = data.overview ? (data.overview.length > 250 ? data.overview.substring(0, 250) + '...' : data.overview) : "Sinopsis no disponible.";
        
        const backdropUrl = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'https://placehold.co/1280x720/000000/FFFFFF?text=Sala+Cine';
        const posterUrl = data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : backdropUrl;

        const year = (data.release_date || data.first_air_date || '').substring(0, 4);
        const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
        const genres = data.genres ? data.genres.slice(0, 2).map(g => g.name).join(' • ') : ''; 

        const providers = data['watch/providers']?.results?.MX?.flatrate || []; 
        
        // Recomendaciones (Limitamos a 10)
        const recommendations = data.recommendations?.results?.slice(0, 10) || [];

        const trailer = data.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') || data.videos?.results?.[0];
        const youtubeEmbed = trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&loop=1` : null;

        const safeRedirectUrl = `/app/details/${id}`;

        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>Ver ${title} - Sala Cine</title>
            <meta property="og:image" content="${backdropUrl}">
            <meta name="theme-color" content="#0f0f0f">

            <style>
                :root { 
                    --primary: #E50914; 
                    --bg: #0f0f0f; 
                    --card-bg: #1a1a1a;
                    --text: #fff; 
                    --text-gray: #a3a3a3;
                }
                body { 
                    margin: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; 
                    background: var(--bg); color: var(--text); overflow-x: hidden; padding-bottom: 100px; 
                }
                
                /* === HERO === */
                .hero { position: relative; width: 100%; height: 70vh; display: flex; align-items: flex-end; overflow: hidden; }
                .hero-bg { 
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                    background-size: cover; background-position: center top; z-index: 1; 
                    background-image: var(--bg-mobile); 
                    mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
                    -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
                }
                .hero-gradient { 
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 2; 
                    background: linear-gradient(to top, var(--bg) 10%, rgba(15,15,15,0.6) 50%, rgba(15,15,15,0.4) 100%);
                }

                @media (min-width: 768px) {
                    .hero { height: 85vh; }
                    .hero-bg { background-image: var(--bg-desktop); background-position: center; mask-image: none; }
                    .content { max-width: 1000px; margin: 0 auto; text-align: center; }
                    .meta, .actions { justify-content: center; }
                    .actions .btn-primary { display: flex; } 
                    .sticky-cta { display: none !important; }
                    body { padding-bottom: 0; }
                }

                .content { position: relative; z-index: 10; padding: 25px; width: 100%; box-sizing: border-box; animation: fadeUp 0.8s ease; }
                
                h1 { font-size: 2.5rem; margin: 0 0 10px 0; line-height: 1; font-weight: 800; text-shadow: 0 4px 30px rgba(0,0,0,1); }
                .tags { font-size: 0.75rem; color: #ccc; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; font-weight: 600; }
                .meta { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; font-size: 0.9rem; color: var(--text-gray); }
                .rating-badge { background: #f5c518; color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; }

                /* BOTONES */
                .actions { display: flex; gap: 10px; flex-wrap: wrap; }
                .btn { 
                    border: none; padding: 14px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; 
                    display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: 0.2s; font-size: 1rem;
                }
                .btn-primary { background: var(--primary); color: white; }
                .btn-secondary { background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; }
                @media (max-width: 767px) { .actions .btn-primary { display: none; } } /* Ocultar en móvil */

                /* STICKY CTA */
                .sticky-cta { position: fixed; bottom: 20px; left: 20px; right: 20px; z-index: 999; animation: slideUp 0.5s ease 1s backwards; }
                .sticky-btn { 
                    width: 100%; background: var(--primary); color: white; padding: 16px; border-radius: 12px; 
                    text-align: center; font-weight: bold; text-decoration: none; display: block; 
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
                }

                /* CONTENEDOR PRINCIPAL */
                .main-container { padding: 0 20px; max-width: 1000px; margin: 0 auto; position: relative; z-index: 20; top: -20px; }

                /* PLAYER */
                .player-box { 
                    position: relative; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; 
                    box-shadow: 0 20px 50px rgba(0,0,0,0.6); border: 1px solid #333; margin-bottom: 15px; cursor: pointer;
                }
                .play-overlay { position: absolute; top:0; left:0; width:100%; height:100%; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); }
                .play-circle { width: 60px; height: 60px; background: rgba(229, 9, 20, 0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px rgba(229, 9, 20, 0.5); }

                /* PROVIDERS (BARRA ELEGANTE) */
                .providers-bar { 
                    display: flex; align-items: center; gap: 15px; background: rgba(30,30,30,0.6); 
                    backdrop-filter: blur(12px); padding: 12px 20px; border-radius: 10px; margin-bottom: 30px; 
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .prov-label { font-size: 0.8rem; color: #aaa; white-space: nowrap; }
                .prov-list { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
                .prov-icon { width: 35px; height: 35px; border-radius: 8px; object-fit: cover; }

                .overview { color: #ccc; line-height: 1.6; margin-bottom: 30px; font-size: 1rem; }
                .section-title { font-size: 1.2rem; font-weight: 700; margin: 30px 0 15px 0; border-left: 3px solid var(--primary); padding-left: 10px; }

                /* LISTAS HORIZONTALES (Episodios y Recs) */
                .scroll-row { display: flex; overflow-x: auto; gap: 15px; padding-bottom: 10px; scrollbar-width: none; }
                .scroll-row::-webkit-scrollbar { display: none; }

                /* EPISODIOS CARD */
                .ep-card { min-width: 260px; cursor: pointer; position: relative; transition: transform 0.2s; }
                .ep-card:active { transform: scale(0.98); }
                .ep-img-wrap { 
                    width: 100%; aspect-ratio: 16/9; border-radius: 8px; overflow: hidden; margin-bottom: 8px; position: relative; background: #222;
                }
                .ep-img { width: 100%; height: 100%; object-fit: cover; opacity: 0.8; transition: opacity 0.3s; }
                .ep-play-mini {
                    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    width: 35px; height: 35px; background: rgba(0,0,0,0.6); border: 2px solid white; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                }
                .ep-info h4 { margin: 0; font-size: 0.9rem; color: #eee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .ep-info span { font-size: 0.75rem; color: #888; }

                /* RECOMENDACIONES (Vertical Posters) */
                .rec-card { min-width: 110px; cursor: pointer; }
                .rec-img { width: 110px; height: 165px; border-radius: 8px; object-fit: cover; margin-bottom: 5px; background: #222; }
                .rec-title { font-size: 0.8rem; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }

                .footer { text-align: center; padding: 40px 20px; color: #555; font-size: 0.8rem; margin-top: 40px; }
                
                @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
            </style>
        </head>
        
        <body style="--bg-desktop: url('${backdropUrl}'); --bg-mobile: url('${posterUrl}');">

            <div class="hero">
                <div class="hero-bg"></div>
                <div class="hero-gradient"></div>
                
                <div class="content">
                    <div class="tags">${type === 'tv' ? 'Serie' : 'Película'} • ${genres}</div>
                    <h1>${title}</h1>
                    <div class="meta">
                        <span class="rating-badge">IMDb ${rating}</span>
                        <span>${year}</span>
                        <span>${data.runtime ? data.runtime + ' min' : (data.number_of_seasons ? data.number_of_seasons + ' Temps' : '')}</span>
                    </div>

                    <div class="actions">
                        <a href="${safeRedirectUrl}" class="btn btn-primary">VER AHORA</a>
                        ${youtubeEmbed ? '<a href="#trailer" class="btn btn-secondary">Trailer</a>' : ''}
                    </div>
                </div>
            </div>

            <div class="sticky-cta">
                <a href="${safeRedirectUrl}" class="sticky-btn">Abrir en Sala Cine App</a>
            </div>

            <div class="main-container">
                
                <div class="player-box" id="trailer" onclick="window.location.href='${safeRedirectUrl}'">
                    ${youtubeEmbed 
                        ? `<iframe src="${youtubeEmbed}" width="100%" height="100%" frameborder="0" style="pointer-events:none;"></iframe>` 
                        : `<img src="${backdropUrl}" width="100%" height="100%" style="object-fit:cover;">`
                    }
                    <div style="position:absolute; top:0; left:0; width:100%; height:100%; z-index:5;"></div>
                    <div class="play-overlay" style="pointer-events:none;">
                        <div class="play-circle">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                </div>

                ${providers.length > 0 ? `
                <div class="providers-bar">
                    <div class="prov-label">Disponible en:</div>
                    <div class="prov-list">
                        ${providers.map(p => `<img src="https://image.tmdb.org/t/p/w200${p.logo_path}" class="prov-icon" alt="${p.provider_name}" title="${p.provider_name}">`).join('')}
                    </div>
                </div>
                ` : ''}

                <p class="overview">${overview}</p>

                ${episodes.length > 0 ? `
                <div class="section-title">Temporada 1</div>
                <div class="scroll-row">
                    ${episodes.map(ep => `
                        <div class="ep-card" onclick="window.location.href='${safeRedirectUrl}'">
                            <div class="ep-img-wrap">
                                <img src="${ep.still_path ? 'https://image.tmdb.org/t/p/w400'+ep.still_path : posterUrl}" class="ep-img" loading="lazy">
                                <div class="ep-play-mini">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                                </div>
                            </div>
                            <div class="ep-info">
                                <h4>${ep.episode_number}. ${ep.name}</h4>
                                <span>${ep.runtime ? ep.runtime + ' min' : ''}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                ${recommendations.length > 0 ? `
                <div class="section-title">También te podría gustar</div>
                <div class="scroll-row">
                    ${recommendations.map(rec => `
                        <div class="rec-card" onclick="window.location.href='/view/${rec.media_type || type}/${rec.id}'">
                            <img src="${rec.poster_path ? 'https://image.tmdb.org/t/p/w200'+rec.poster_path : 'https://placehold.co/200x300'}" class="rec-img" loading="lazy">
                            <span class="rec-title">${rec.title || rec.name}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                <div class="footer">
                    Sala Cine © 2026 - <a href="${PLAY_STORE_URL}" style="color:#777;">Descargar App</a>
                </div>
            </div>

        </body>
        </html>
        `;

        res.send(html);
    });
};
