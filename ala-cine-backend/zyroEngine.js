const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // --- NUEVO ENDPOINT: HOME DINÁMICO ---
    app.get('/api/zyro-home', async (req, res) => {
        const cacheKey = 'zyro_home_data';
        const cachedResult = cache.get(cacheKey);

        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo Home desde caché`);
            return res.json(cachedResult);
        }

        try {
            // 1. Estrenos (Now Playing)
            const estrenosRes = await axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=es-ES&page=1`);
            const estrenos = estrenosRes.data.results.slice(0, 10).map(m => ({
                id: m.id,
                titulo: m.title,
                subtitulo: `Estreno · ${m.release_date ? m.release_date.substring(0, 4) : ''}`,
                posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                tipo: 'movie'
            }));

            // 2. Tendencias (Trending General)
            const tendenciasRes = await axios.get(`https://api.themoviedb.org/3/trending/all/day?api_key=${TMDB_API_KEY}&language=es-ES`);
            const tendencias = tendenciasRes.data.results.slice(0, 10).map(t => ({
                id: t.id,
                titulo: t.title || t.name,
                subtitulo: `Tendencia · ${t.media_type === 'movie' ? 'Película' : 'Serie'}`,
                posterPath: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                tipo: t.media_type
            }));

            // 3. Carrusel Temático Automatizado (Basado en el mes actual)
            const currentMonth = new Date().getMonth(); 
            let themeName = 'Destacados del Mes';
            let genreId = 28; // Acción por defecto

            if (currentMonth === 9) { // Octubre - Terror
                themeName = 'Especial de Halloween';
                genreId = 27; 
            } else if (currentMonth === 11) { // Diciembre - Familiar
                themeName = 'Especial Navideño';
                genreId = 10751; 
            }

            const tematicoRes = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_genres=${genreId}&sort_by=popularity.desc&page=1`);
            const carruselTematico = {
                titulo: themeName,
                items: tematicoRes.data.results.slice(0, 10).map(m => ({
                    id: m.id,
                    titulo: m.title,
                    posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                    anio: m.release_date ? m.release_date.substring(0, 4) : ''
                }))
            };

            // 4. Categorías Dinámicas Básicas
            const categorias = [
                { titulo: "Acción", query: "Películas de Acción", color: "0xFFE91E63" },
                { titulo: "Terror", query: "Películas de Terror", color: "0xFFFF5722" },
                { titulo: "Ciencia Ficción", query: "Películas de Ciencia Ficción", color: "0xFF9C27B0" },
                { titulo: "Comedia", query: "Películas de Comedia", color: "0xFF00BCD4" }
            ];

            const respuestaFinal = {
                estrenos,
                tendencias,
                carruselTematico,
                categorias
            };

            cache.set(cacheKey, respuestaFinal, 3600); // Caché de 1 hora
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error obteniendo Home:", error.message);
            res.status(500).json({ error: "No se pudo cargar el inicio dinámico." });
        }
    });

    // --- ENDPOINT ORIGINAL MODIFICADO: BÚSQUEDA Y PAGINACIÓN ---
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        const page = parseInt(req.query.page) || 1; // PAGINACIÓN AÑADIDA
        
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // SISTEMA DE CACHÉ ACTUALIZADO CON PÁGINA
        const cacheKey = `zyro_universal_${query.toLowerCase().trim()}_p${page}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${query} (Página ${page})`);
            return res.json(cachedResult);
        }

        try {
            let metadata = null;
            let enlacesFinales = [];
            let sugerencias = [];
            let tmdbId = null;
            let mediaType = 'movie';
            let tituloOficial = query;
            let anioEstreno = null;

            // 2. BUSCAR EN TMDB (Aplica paginación)
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=${page}`);
                const results = tmdbRes.data.results;

                if (results && results.length > 0) {
                    sugerencias = results.filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(r => ({
                        titulo: r.title || r.name,
                        imagen: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                        anio: (r.release_date || r.first_air_date || '').split('-')[0]
                    }));

                    if (page === 1) { // Metadata principal solo en la primera página
                        const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                        
                        if (bestMatch) {
                            tmdbId = bestMatch.id;
                            mediaType = bestMatch.media_type || 'movie';
                            tituloOficial = bestMatch.title || bestMatch.name;
                            
                            if (bestMatch.release_date) anioEstreno = bestMatch.release_date.split('-')[0];
                            else if (bestMatch.first_air_date) anioEstreno = bestMatch.first_air_date.split('-')[0];

                            metadata = {
                                tmdb_id: tmdbId,
                                titulo: tituloOficial,
                                poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                                tipo: mediaType,
                                descripcion: bestMatch.overview || "Sin sinopsis disponible.",
                                anio: anioEstreno
                            };
                        }
                    }
                }
            } catch (tmdbError) {
                console.log("[ZYRO] TMDB falló:", tmdbError.message);
            }

            // 3. METADATA GENÉRICO (Fallback)
            if (!metadata && page === 1) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null, 
                    tipo: 'web_search',
                    descripcion: `Resultados universales de la red para: "${query}"`,
                    anio: null
                };
            }

            // 4. PROVEEDORES OFICIALES (Solo página 1)
            if (tmdbId && page === 1) {
                try {
                    const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                    const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                    
                    if (ecProviders.flatrate) {
                        ecProviders.flatrate.forEach(provider => {
                            const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                            enlacesFinales.push({
                                sitioWeb: domain,
                                titulo: `Ver en ${provider.provider_name}`,
                                descripcion: `Disponible oficialmente en ${provider.provider_name}.`,
                                calidad: "Oficial",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales",
                                isPremium: false
                            });
                        });
                    }
                } catch (providerError) {
                    console.log("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 5. EL BUSCADOR UNIVERSAL (Mejora de extracción de imágenes)
            try {
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
                ];
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                    headers: {
                        'User-Agent': randomUserAgent,
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'es-ES,es;q=0.9'
                    },
                    timeout: 15000
                });

                const $ = cheerio.load(scraperRes.data);
                const startIndex = (page - 1) * 10; // Offset rudimentario
                
                $('.result').each((index, element) => {
                    if (index < startIndex) return true;
                    if (enlacesFinales.length >= 15 * page) return false; 

                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();
                    
                    // Extracción de imagen web si está disponible
                    let imgIcon = $(element).find('.result__icon__img').attr('src');
                    if (imgIcon && imgIcon.startsWith('//')) imgIcon = 'https:' + imgIcon;

                    if (rawTitle && rawUrl) {
                        let cleanUrl = rawUrl;
                        if (rawUrl.includes('uddg=')) {
                            try {
                                const urlObj = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
                                const uddgParam = urlObj.searchParams.get('uddg');
                                if (uddgParam) cleanUrl = decodeURIComponent(uddgParam);
                            } catch (e) {}
                        }

                        if (!cleanUrl.startsWith('http')) return true;

                        let dominio = 'Web';
                        try { dominio = new URL(cleanUrl).hostname.replace('www.', ''); } catch (e) {}

                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet || 'Resultado de la web abierta.',
                            calidad: 'Web',
                            urlDestino: cleanUrl,
                            categoria: 'Navegación',
                            favicon: imgIcon || null,
                            isPremium: false
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] Scraping web falló para "${query}":`, scrapeError.message);
            }

            // 6. BUSCAR EN TU MONGODB (Solo en página 1)
            if (page === 1) {
                const db = getDb();
                if (db) {
                    const dbQuery = { $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] };
                    if (tmdbId) dbQuery.$or.push({ tmdb_id: tmdbId });

                    try {
                        const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();
                        customLinks.reverse().forEach(link => {
                            enlacesFinales.unshift({
                                sitioWeb: link.sitioWeb,
                                titulo: link.titulo,
                                descripcion: link.descripcion || "Enlace destacado y verificado.",
                                calidad: link.calidad || "Premium",
                                urlDestino: link.urlDestino,
                                categoria: link.categoria || "Destacado",
                                isPremium: true 
                            });
                        });
                    } catch(dbErr) {
                        console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                    }
                }
            }

            // 7. EMPAQUETAR Y ENVIAR A ANDROID
            const respuestaFinal = {
                metadata: page === 1 ? metadata : null,
                sugerencias: sugerencias,
                enlaces: enlacesFinales,
                paginaActual: page
            };

            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ 
                metadata: page === 1 ? { tmdb_id: null, titulo: query, tipo: "error", descripcion: "Error." } : null,
                sugerencias: [], enlaces: [], paginaActual: page 
            });
        }
    });
};
