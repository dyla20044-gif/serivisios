const axios = require('axios');
const NodeCache = require('node-cache');

// Caché interna para no saturar la API de TMDB (TTL: 1 hora)
const bridgeCache = new NodeCache({ stdTTL: 3600 });

module.exports = function(app) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    // URL de la Play Store (Visual)
    const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.salacine.app"; 

    // Función auxiliar para obtener datos
    async function getTmdbData(id, type) {
        const cacheKey = `bridge_${type}_${id}`;
        const cached = bridgeCache.get(cacheKey);
        if (cached) return cached;

        try {
            const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=es-MX&append_to_response=credits,videos,images,watch/providers,recommendations`;
            const response = await axios.get(url);
            bridgeCache.set(cacheKey, response.data);
            return response.data;
        } catch (error) {
            console.error(`[Bridge] Error TMDB ${id}:`, error.message);
            return null;
        }
    }

    // Ruta Universal para Movies y TV
    app.get('/view/:type/:id', async (req, res) => {
        const { type, id } = req.params;
        
        if (type !== 'movie' && type !== 'tv') return res.status(404).send('Tipo de contenido inválido');

        const data = await getTmdbData(id, type);
        
        if (!data) return res.status(404).send('Contenido no encontrado en TMDB');

        // === PROCESAMIENTO DE DATOS ===
        const title = data.title || data.name;
        const overview = data.overview ? (data.overview.length > 300 ? data.overview.substring(0, 300) + '...' : data.overview) : "Sinopsis no disponible.";
        
        // Imágenes
        const backdropUrl = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'https://placehold.co/1280x720/000000/FFFFFF?text=Sala+Cine';
        const posterUrl = data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : backdropUrl;

        const year = (data.release_date || data.first_air_date || '').substring(0, 4);
        const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
        const genres = data.genres ? data.genres.slice(0, 2).map(g => g.name).join(' • ') : ''; 
        
        const cast = data.credits?.cast?.slice(0, 6).map(c => ({
            name: c.name,
            role: c.character,
            img: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null
        })) || [];

        // Procesar Temporadas si es Serie
        const seasons = (type === 'tv' && data.seasons) ? data.seasons.filter(s => s.season_number > 0) : [];

        const providers = data['watch/providers']?.results?.MX?.flatrate || []; 

        const trailer = data.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') || data.videos?.results?.[0];
        const youtubeEmbed = trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&loop=1` : null;

        // Redirección segura a tu app
        const safeRedirectUrl = `/app/details/${id}`;

        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>Ver ${title} (${year}) - Sala Cine</title>
            
            <meta property="og:title" content="▶️ Ver ${title} (${year}) Gratis">
            <meta property="og:description" content="${overview}">
            <meta property="og:image" content="${backdropUrl}">
            <meta property="og:site_name" content="Sala Cine App">
            <meta name="theme-color" content="#0f0f0f">

            <style>
                :root { 
                    --primary: #E50914; 
                    --bg: #0f0f0f; 
                    --text: #fff; 
                    --glass: rgba(255, 255, 255, 0.1); 
                }
                body { 
                    margin: 0; 
                    font-family: 'Inter', system-ui, -apple-system, sans-serif; 
                    background: var(--bg); 
                    color: var(--text); 
                    overflow-x: hidden; 
                    padding-bottom: 90px; 
                }
                
                /* === HERO / PORTADA === */
                .hero { 
                    position: relative; 
                    width: 100%; 
                    overflow: hidden; 
                    display: flex; 
                    align-items: flex-end; 
                    height: 70vh; 
                }
                
                .hero-bg { 
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                    background-size: cover; background-position: center top; 
                    z-index: 1; filter: brightness(0.65); 
                    background-image: var(--bg-mobile);
                    transition: transform 10s ease;
                    animation: zoomIn 10s infinite alternate;
                }

                .hero-gradient { 
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 2; 
                    background: linear-gradient(to bottom, rgba(15,15,15,0.3) 0%, rgba(15,15,15,0.1) 50%, var(--bg) 98%);
                }
                
                .content { position: relative; z-index: 10; padding: 25px; width: 100%; box-sizing: border-box; }
                
                .tags { font-size: 0.75rem; color: #ccc; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; font-weight: 600; }
                h1 { font-size: 2.5rem; margin: 5px 0 10px 0; line-height: 1.1; font-weight: 800; text-shadow: 0 4px 20px rgba(0,0,0,0.8); }
                
                .meta { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; font-size: 0.95rem; font-weight: 500; }
                .rating { color: #f5c518; font-weight: bold; }
                .year-badge { background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
                
                .actions { display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
                .btn { 
                    flex: 1; padding: 16px 24px; border-radius: 12px; font-weight: 700; 
                    text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; gap: 10px; 
                    transition: transform 0.2s; min-width: 140px; cursor: pointer; border: none; font-size: 1rem;
                }
                .btn-primary { background: var(--primary); color: white; box-shadow: 0 8px 25px rgba(229, 9, 20, 0.4); }
                .btn-secondary { background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); color: white; border: 1px solid rgba(255,255,255,0.1); }
                
                /* LÓGICA DEL BOTÓN: Ocultar el primario en móvil, mostrar en PC */
                @media (max-width: 767px) {
                    /* En celular ocultamos el botón de ver principal porque ya tenemos el flotante */
                    .actions .btn-primary { display: none; }
                }

                /* ESTILOS DE PC */
                @media (min-width: 768px) {
                    .hero { height: 85vh; }
                    .hero-bg { background-image: var(--bg-desktop); background-position: center center; }
                    .content { max-width: 900px; margin: 0 auto; text-align: center; }
                    .meta { justify-content: center; }
                    .actions { justify-content: center; }
                    /* En PC mostramos el botón normal y ocultamos el flotante */
                    .actions .btn-primary { display: flex; } 
                    .sticky-cta { display: none !important; }
                    body { padding-bottom: 0; }
                }

                .sticky-cta {
                    position: fixed; bottom: 20px; left: 20px; right: 20px; z-index: 100;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                    animation: slideUp 0.5s ease-out 1s backwards;
                }
                
                .info-section { padding: 0 25px 40px 25px; max-width: 800px; margin: 0 auto; }
                .overview { color: #ccc; line-height: 1.7; font-size: 1.05rem; margin-bottom: 30px; }
                .section-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 20px; color: #fff; border-left: 4px solid var(--primary); padding-left: 12px; }
                
                /* PLAYER / TRAILER */
                .player-container { 
                    margin: 30px 20px; background: #000; border-radius: 16px; overflow: hidden; position: relative; 
                    border: 1px solid #333; box-shadow: 0 10px 40px rgba(0,0,0,0.5); aspect-ratio: 16/9; cursor: pointer; 
                }
                .play-overlay { position: absolute; top:0; left:0; width:100%; height:100%; display: flex; align-items: center; justify-content: center; z-index: 10; background: rgba(0,0,0,0.2); }
                .play-icon { width: 65px; height: 65px; background: rgba(229, 9, 20, 0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px rgba(229, 9, 20, 0.5); }
                
                /* LISTAS HORIZONTALES (CAST Y TEMPORADAS) */
                .horizontal-list { display: flex; overflow-x: auto; gap: 15px; padding-bottom: 15px; scrollbar-width: none; }
                .horizontal-list::-webkit-scrollbar { display: none; }
                
                /* ESTILOS PARA LAS SERIES/TEMPORADAS */
                .season-card { min-width: 140px; position: relative; cursor: pointer; transition: transform 0.2s; }
                .season-card:active { transform: scale(0.95); }
                .season-img-container { 
                    position: relative; width: 100%; aspect-ratio: 2/3; border-radius: 8px; overflow: hidden; margin-bottom: 8px; border: 1px solid #333;
                }
                .season-img { width: 100%; height: 100%; object-fit: cover; }
                .season-play {
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;
                }
                .mini-play-icon {
                    width: 40px; height: 40px; background: rgba(229,9,20,0.9); border-radius: 50%;
                    display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);
                }
                .season-name { font-size: 0.9rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .season-eps { font-size: 0.75rem; color: #888; }

                /* CAST */
                .cast-item { min-width: 90px; text-align: center; }
                .cast-img { width: 70px; height: 70px; border-radius: 50%; object-fit: cover; border: 2px solid #333; margin-bottom: 8px; }
                .cast-name { font-size: 0.8rem; font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                
                .providers { display: flex; gap: 12px; flex-wrap: wrap; }
                .provider-icon { width: 45px; height: 45px; border-radius: 10px; }
                .footer { text-align: center; padding: 40px 20px 80px 20px; color: #555; font-size: 0.8rem; }
                
                @keyframes zoomIn { from { transform: scale(1); } to { transform: scale(1.05); } }
                @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            </style>
        </head>
        
        <body style="--bg-desktop: url('${backdropUrl}'); --bg-mobile: url('${posterUrl}');">

            <div class="hero">
                <div class="hero-bg"></div>
                <div class="hero-gradient"></div>
                
                <div class="content">
                    <div class="tags">${type === 'tv' ? 'Serie TV' : 'Película'} • ${genres}</div>
                    <h1>${title}</h1>
                    <div class="meta">
                        <span class="rating">★ ${rating}</span>
                        <span class="year-badge">${year}</span>
                        <span>${data.runtime ? '• ' + data.runtime + ' min' : (data.number_of_seasons ? '• ' + data.number_of_seasons + ' Temp.' : '')}</span>
                    </div>

                    <div class="actions">
                        <a href="${safeRedirectUrl}" class="btn btn-primary">
                            ▶ VER EN APP
                        </a>
                        ${youtubeEmbed ? '<a href="#trailer" class="btn btn-secondary">Trailer</a>' : ''}
                    </div>
                </div>
            </div>

            <div class="sticky-cta">
                 <a href="${safeRedirectUrl}" class="btn btn-primary" style="width: 100%; box-shadow: 0 5px 20px rgba(0,0,0,0.5);">
                    Abrir en Sala Cine App
                </a>
            </div>

            <div class="info-section">
                
                <div class="player-container" onclick="window.location.href='${safeRedirectUrl}'" id="trailer">
                    ${youtubeEmbed 
                        ? `<iframe src="${youtubeEmbed}" width="100%" height="100%" frameborder="0" style="pointer-events:none;"></iframe>` 
                        : `<img src="${backdropUrl}" width="100%" height="100%" style="object-fit:cover; opacity:0.6;">`
                    }
                    <div style="position:absolute; top:0; left:0; width:100%; height:100%; cursor:pointer; z-index:20;"></div>
                    <div class="play-overlay" style="pointer-events:none;">
                        <div class="play-icon">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                </div>

                <div class="section-title">Sinopsis</div>
                <p class="overview">${overview}</p>
                
                ${seasons.length > 0 ? `
                <div class="section-title">Temporadas</div>
                <div class="horizontal-list">
                    ${seasons.map(s => `
                        <div class="season-card" onclick="window.location.href='${safeRedirectUrl}'">
                            <div class="season-img-container">
                                <img src="${s.poster_path ? 'https://image.tmdb.org/t/p/w300'+s.poster_path : posterUrl}" class="season-img">
                                <div class="season-play">
                                    <div class="mini-play-icon">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                                    </div>
                                </div>
                            </div>
                            <div class="season-name">${s.name}</div>
                            <div class="season-eps">${s.episode_count} Capítulos</div>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                ${providers.length > 0 ? `
                <div class="section-title">Disponible en:</div>
                <div class="providers">
                    ${providers.map(p => `<img src="https://image.tmdb.org/t/p/w200${p.logo_path}" class="provider-icon" alt="${p.provider_name}">`).join('')}
                </div>
                ` : ''}

                ${cast.length > 0 ? `
                <div class="section-title">Reparto</div>
                <div class="horizontal-list">
                    ${cast.map(c => `
                        <div class="cast-item">
                            <img src="${c.img || 'https://placehold.co/100?text=Actor'}" class="cast-img">
                            <span class="cast-name">${c.name}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>

            <div class="footer">
                Sala Cine © 2026<br>
                <a href="${PLAY_STORE_URL}" style="color:#777; text-decoration:none;">Descargar App Oficial</a>
            </div>

        </body>
        </html>
        `;

        res.send(html);
    });
};
