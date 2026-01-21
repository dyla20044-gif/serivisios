const axios = require('axios');
const NodeCache = require('node-cache');

// Caché interna para no saturar la API de TMDB (TTL: 1 hora)
const bridgeCache = new NodeCache({ stdTTL: 3600 });

module.exports = function(app) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    // URL de tu App en Play Store
    const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.salacine.app"; 

    // Función auxiliar para obtener datos
    async function getTmdbData(id, type) {
        const cacheKey = `bridge_${type}_${id}`;
        const cached = bridgeCache.get(cacheKey);
        if (cached) return cached;

        try {
            // Solicitamos detalles a TMDB
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
        
        // Validación básica
        if (type !== 'movie' && type !== 'tv') return res.status(404).send('Tipo de contenido inválido');

        const data = await getTmdbData(id, type);
        
        if (!data) return res.status(404).send('Contenido no encontrado en TMDB');

        // Procesamiento de datos para la vista
        const title = data.title || data.name;
        const overview = data.overview ? (data.overview.length > 300 ? data.overview.substring(0, 300) + '...' : data.overview) : "Sinopsis no disponible.";
        const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'https://placehold.co/1280x720/000000/FFFFFF?text=Sala+Cine';
        const year = (data.release_date || data.first_air_date || '').substring(0, 4);
        const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
        const genres = data.genres ? data.genres.slice(0, 3).map(g => g.name).join(' • ') : '';
        
        // Elenco
        const cast = data.credits?.cast?.slice(0, 6).map(c => ({
            name: c.name,
            role: c.character,
            img: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null
        })) || [];

        // Proveedores
        const providers = data['watch/providers']?.results?.MX?.flatrate || []; 

        // Trailer
        const trailer = data.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') || data.videos?.results?.[0];
        const youtubeEmbed = trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&loop=1` : null;

        // === CORRECCIÓN IMPORTANTE ===
        // Dejamos el enlace LIMPIO, exactamente como lo tienes en tu server.js original.
        // Sin '&type=', solo el ID. Así tu App sabe ir directo al detalle.
        const appScheme = `salacine://details?id=${id}`; 
        // =============================

        // --- RENDERIZADO HTML ---
        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ver ${title} (${year}) - Sala Cine</title>
            
            <meta property="og:title" content="▶️ Ver ${title} (${year}) Gratis">
            <meta property="og:description" content="${overview}">
            <meta property="og:image" content="${backdrop}">
            <meta property="og:site_name" content="Sala Cine App">
            <meta name="theme-color" content="#141414">

            <style>
                :root { --primary: #E50914; --bg: #0f0f0f; --text: #fff; --glass: rgba(255, 255, 255, 0.1); }
                body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); overflow-x: hidden; }
                
                .hero { position: relative; height: 85vh; width: 100%; overflow: hidden; display: flex; align-items: flex-end; }
                .hero-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: url('${backdrop}') center/cover no-repeat; z-index: 1; filter: brightness(0.6); transform: scale(1.1); transition: transform 0.5s; }
                .hero-gradient { position: absolute; bottom: 0; width: 100%; height: 100%; background: linear-gradient(to top, var(--bg) 5%, transparent 80%); z-index: 2; }
                
                .content { position: relative; z-index: 10; padding: 20px; width: 100%; max-width: 800px; margin: 0 auto; }
                
                .tags { font-size: 0.85rem; color: #ccc; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
                h1 { font-size: 2.5rem; margin: 5px 0; line-height: 1.1; font-weight: 800; text-shadow: 0 2px 10px rgba(0,0,0,0.5); }
                .meta { display: flex; align-items: center; gap: 15px; margin: 15px 0; font-size: 0.9rem; }
                .rating { background: #f5c518; color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
                
                .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
                .btn { flex: 1; padding: 14px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s; min-width: 140px; cursor: pointer; }
                .btn-primary { background: var(--primary); color: white; border: none; box-shadow: 0 4px 15px rgba(229, 9, 20, 0.4); }
                .btn-primary:active { transform: scale(0.98); }
                .btn-secondary { background: var(--glass); backdrop-filter: blur(10px); color: white; border: 1px solid rgba(255,255,255,0.2); }
                
                .player-container { margin: 30px 20px; background: #000; border-radius: 12px; overflow: hidden; position: relative; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); aspect-ratio: 16/9; cursor: pointer; }
                .iframe-cover { position: absolute; top:0; left:0; width:100%; height:100%; z-index: 5; background: transparent; }
                .play-overlay { position: absolute; top:0; left:0; width:100%; height:100%; display: flex; align-items: center; justify-content: center; z-index: 10; background: rgba(0,0,0,0.3); }
                .play-icon { width: 60px; height: 60px; background: rgba(229, 9, 20, 0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px rgba(229, 9, 20, 0.6); animation: pulse 2s infinite; }
                
                .info-section { padding: 20px; max-width: 800px; margin: 0 auto; }
                .overview { color: #bbb; line-height: 1.6; font-size: 1rem; margin-bottom: 25px; }
                
                .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 15px; color: #fff; border-left: 4px solid var(--primary); padding-left: 10px; }
                
                .cast-row { display: flex; overflow-x: auto; gap: 15px; padding-bottom: 10px; scrollbar-width: none; }
                .cast-item { min-width: 90px; text-align: center; }
                .cast-img { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2px solid #333; margin-bottom: 5px; }
                .cast-name { font-size: 0.8rem; color: #fff; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .cast-role { font-size: 0.7rem; color: #888; }
                
                .providers { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 30px; }
                .provider-icon { width: 40px; height: 40px; border-radius: 8px; }
                
                .footer { text-align: center; padding: 40px 20px; color: #555; font-size: 0.8rem; }
                
                @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
            </style>
        </head>
        <body>

            <div class="hero">
                <div class="hero-bg"></div>
                <div class="hero-gradient"></div>
                
                <div class="content">
                    <div class="tags">${year} • ${genres}</div>
                    <h1>${title}</h1>
                    <div class="meta">
                        <span class="rating">★ ${rating}</span>
                        <span>${data.runtime ? data.runtime + ' min' : (data.number_of_seasons ? data.number_of_seasons + ' Temporadas' : '')}</span>
                    </div>

                    <div class="actions">
                        <a href="#" onclick="openApp()" class="btn btn-primary">
                            ▶ VER EN APP GRATIS
                        </a>
                        ${youtubeEmbed ? '<a href="#trailer" class="btn btn-secondary">Ver Trailer</a>' : ''}
                    </div>
                </div>
            </div>

            <div class="info-section">
                <div class="section-title">Vista Previa</div>
                <div class="player-container" onclick="openApp()">
                    ${youtubeEmbed 
                        ? `<iframe src="${youtubeEmbed}" width="100%" height="100%" frameborder="0" style="pointer-events:none;"></iframe>` 
                        : `<img src="${backdrop}" width="100%" height="100%" style="object-fit:cover; opacity:0.5;">`
                    }
                    <div class="iframe-cover"></div>
                    <div class="play-overlay">
                        <div class="play-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>
                </div>

                <p class="overview">${overview}</p>

                ${providers.length > 0 ? `
                <div class="section-title">Disponible Legalmente en:</div>
                <div class="providers">
                    ${providers.map(p => `<img src="https://image.tmdb.org/t/p/w200${p.logo_path}" class="provider-icon" alt="${p.provider_name}">`).join('')}
                </div>
                <p style="font-size:0.7rem; color:#666;">Fuente: JustWatch. Sala Cine es un indexador de contenido.</p>
                ` : ''}

                ${cast.length > 0 ? `
                <div class="section-title">Reparto Principal</div>
                <div class="cast-row">
                    ${cast.map(c => `
                        <div class="cast-item">
                            <img src="${c.img || 'https://placehold.co/100?text=User'}" class="cast-img">
                            <span class="cast-name">${c.name}</span>
                            <span class="cast-role">${c.role}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>

            <div class="footer">
                Sala Cine © 2026<br>
                <a href="${PLAY_STORE_URL}" style="color:#777;">Descargar App</a>
            </div>

            <script>
                function openApp() {
                    const appUrl = "${appScheme}"; 
                    const storeUrl = "${PLAY_STORE_URL}";
                    
                    // 1. Intentar abrir la App
                    window.location = appUrl;

                    // 2. Si en 1.5s no se ha ido de la página, asumir que no tiene la app
                    setTimeout(function() {
                        // Verificamos si la página sigue activa (usuario no cambió de app)
                        if (!document.hidden) {
                            window.location = storeUrl;
                        }
                    }, 1500);
                }
            </script>
        </body>
        </html>
        `;

        res.send(html);
    });
};
