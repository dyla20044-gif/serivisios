const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // --- 1. NUEVO ENDPOINT: HOME DINÁMICO (Con Carrusel Temático) ---
    app.get('/api/zyro-home', async (req, res) => {
        const cacheKey = 'zyro_home_data';
        const cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            console.log(`[ZYRO] Sirviendo Home desde caché`);
            return res.json(cachedData);
        }

        try {
            // Promesas en paralelo para acelerar la carga inicial
            const [trendingRes, estrenosRes] = await Promise.all([
                axios.get(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=es-ES`),
                axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=es-ES`)
            ]);

            // Lógica de Carrusel Temático Automatizado (basado en la temporada)
            const mesActual = new Date().getMonth(); // 0 = Enero, 9 = Octubre, 11 = Diciembre
            let temaId = 28; // Acción por defecto
            let temaNombre = "Épicos de Acción";
            
            if (mesActual === 9) { temaId = 27; temaNombre = "Especial Halloween"; }
            else if (mesActual === 11) { temaId = 10751; temaNombre = "Magia Navideña"; }
            else if (mesActual === 1 || mesActual === 2) { temaId = 10749; temaNombre = "Temporada de Romance"; }
            else if (mesActual === 6 || mesActual === 7) { temaId = 878; temaNombre = "Blockbusters de Verano"; }
            
            const tematicosRes = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_genres=${temaId}&sort_by=popularity.desc`);

            const formatData = (results) => results.slice(0, 10).map(m => ({
                id: m.id,
                titulo: m.title || m.name,
                subtitulo: m.release_date ? m.release_date.split('-')[0] : "N/A",
                posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
                backdropPath: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : null
            }));

            const responseData = {
                estrenos: formatData(estrenosRes.data.results),
                tendencias: formatData(trendingRes.data.results),
                carruselTematico: {
                    titulo: temaNombre,
                    items: formatData(tematicosRes.data.results)
                },
                categoriasPopulares: [
                    { id: 28, nombre: "Acción" },
                    { id: 878, nombre: "Ciencia Ficción" },
                    { id: 27, nombre: "Terror" },
                    { id: 35, nombre: "Comedia" },
                    { id: 18, nombre: "Drama" },
                    { id: 16, nombre: "Animación" }
                ]
            };

            cache.set(cacheKey, responseData, 7200); // Caché de 2 horas para optimizar peticiones a TMDB
            res.json(responseData);
        } catch (error) {
            console.error("[ZYRO] Error cargando Home dinámico:", error.message);
            res.status(500).json({ error: "Error cargando datos de inicio" });
        }
    });

    // --- 2. ENDPOINT DE BÚSQUEDA (Universal, Paginación e Imágenes Web) ---
    app.get('/api/zyro-search', async (req, res) => {
        const { query, page = 1 } = req.query; // Paginación soportada
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

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

            // 2.1 BUSCAR EN TMDB (Prioridad para Películas, Series o Categorías en Página 1)
            if (parseInt(page) === 1) {
                try {
                    // Detección inteligente de búsqueda por categoría (Ej: "Películas de Terror")
                    const categoryMatch = query.match(/Películas de (.*)/i);
                    let tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`;
                    
                    if (categoryMatch) {
                        const genreMap = { "acción": 28, "ciencia ficción": 878, "terror": 27, "comedia": 35, "drama": 18, "animación": 16 };
                        const genreId = genreMap[categoryMatch[1].toLowerCase()];
                        if (genreId) {
                            tmdbUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_genres=${genreId}&sort_by=popularity.desc`;
                        }
                    }

                    const tmdbRes = await axios.get(tmdbUrl);
                    const results = tmdbRes.data.results;

                    if (results && results.length > 0) {
                        // Poblar sugerencias (El Grid de la UI)
                        sugerencias = results.filter(r => r.poster_path).map(r => ({
                            titulo: r.title || r.name,
                            imagen: `https://image.tmdb.org/t/p/w500${r.poster_path}`,
                            anio: (r.release_date || r.first_air_date || "").split('-')[0] || ""
                        }));

                        // Construir Metadata principal si NO es una búsqueda de categoría pura
                        if (!categoryMatch) {
                            const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || results[0];
                            
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
                    console.log("[ZYRO] TMDB no detectó resultados o falló:", tmdbError.message);
                }
            }

            // Fallback de Metadata para el buscador universal
            if (!metadata) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null, 
                    tipo: 'web_search',
                    descripcion: `Mostrando resultados web para: "${query}"`,
                    anio: null
                };
            }

            // 2.2 PROVEEDORES OFICIALES (TMDB Watch Providers - Solo pag 1)
            if (tmdbId && parseInt(page) === 1) {
                try {
                    const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                    const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                    
                    if (ecProviders.flatrate) {
                        ecProviders.flatrate.forEach(provider => {
                            const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                            enlacesFinales.push({
                                sitioWeb: domain,
                                titulo: `Ver en ${provider.provider_name}`,
                                descripcion: `Disponible oficialmente en plataforma.`,
                                calidad: "Oficial",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales",
                                isPremium: false,
                                imagenRef: provider.logo_path ? `https://image.tmdb.org/t/p/w200${provider.logo_path}` : null
                            });
                        });
                    }
                } catch (providerError) {
                    console.log("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 2.3 EL BUSCADOR UNIVERSAL (Scraping Inteligente Anti-Bloqueos con Soporte de Imágenes)
            try {
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
                ];
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

                // Offset simulado para paginación de scraping web
                const offset = (parseInt(page) - 1) * 15;
                const scraperUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${offset > 0 ? `&s=${offset}` : ''}`;

                const scraperRes = await axios.get(scraperUrl, {
                    headers: {
                        'User-Agent': randomUserAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                    },
                    timeout: 15000
                });

                const $ = cheerio.load(scraperRes.data);
                
                $('.result').each((index, element) => {
                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();
                    // Extraer imagen si DuckDuckGo la provee en sus miniaturas HTML
                    const rawImg = $(element).find('.result__icon__img').attr('src');

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

                        const imageUrl = rawImg ? (rawImg.startsWith('//') ? `https:${rawImg}` : rawImg) : null;

                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet || 'Resultado de la web abierta.',
                            calidad: 'Web',
                            urlDestino: cleanUrl,
                            categoria: 'Navegación',
                            isPremium: false,
                            imagenRef: imageUrl
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] Scraping web falló para "${query}" pag ${page}:`, scrapeError.message);
            }

            // 2.4 BUSCAR EN TU MONGODB (Prioridad Máxima - Solo se inyecta en la pág 1 para no duplicar)
            if (parseInt(page) === 1) {
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
                                isPremium: true,
                                imagenRef: link.imagenRef || metadata?.poster // Se apoya en el póster de TMDB si no hay custom
                            });
                        });
                    } catch(dbErr) {
                        console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                    }
                }
            }

            // 2.5 EMPAQUETAR Y ENVIAR A ANDROID
            const respuestaFinal = {
                metadata: parseInt(page) === 1 ? metadata : null,
                sugerencias: sugerencias.length > 0 ? sugerencias : null,
                enlaces: enlacesFinales,
                paginaActual: parseInt(page)
            };

            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ 
                error: "Hubo un problema procesando la búsqueda.",
                paginaActual: page
            });
        }
    });
};
