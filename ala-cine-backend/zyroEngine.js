const axios = require('axios');
const cheerio = require('cheerio'); 

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // --- NUEVO ENDPOINT: HOME DINÁMICO (TENDENCIAS) ---
    app.get('/api/zyro-home', async (req, res) => {
        const cacheKey = `zyro_home_trending`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo Home desde caché`);
            return res.json(cachedResult);
        }

        try {
            // Obtenemos las tendencias de la semana de TMDB
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=es-ES`);
            const topMovies = tmdbRes.data.results.slice(0, 10).map(m => ({
                id: m.id,
                titulo: m.title || m.name,
                poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
                backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null, // Alta calidad para el carrusel
                descripcion: m.overview || "Sin sinopsis disponible.",
                anio: m.release_date ? m.release_date.split('-')[0] : 'N/A',
                rating: m.vote_average ? m.vote_average.toFixed(1) : 'N/A'
            }));

            const result = { destacados: topMovies };
            cache.set(cacheKey, result, 3600); // Caché de 1 hora
            res.json(result);

        } catch (error) {
            console.error("[ZYRO] Error obteniendo Home:", error.message);
            res.status(500).json({ destacados: [] });
        }
    });

    // --- ENDPOINT MEJORADO: BÚSQUEDA UNIVERSAL ---
    app.get('/api/zyro-search', async (req, res) => {
        const { query, genreId } = req.query; // Ahora acepta genreId para búsquedas por categoría
        if (!query && !genreId) return res.status(400).json({ error: "Falta el parámetro 'query' o 'genreId'" });

        const searchRef = genreId ? `genre_${genreId}` : query.toLowerCase().trim();
        const cacheKey = `zyro_universal_${searchRef}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${searchRef}`);
            return res.json(cachedResult);
        }

        try {
            let metadata = null;
            let enlacesFinales = [];
            let tmdbId = null;
            let mediaType = 'movie';
            let tituloOficial = query || "Categoría Seleccionada";

            // 1. BUSCAR EN TMDB (Prioridad para Películas, Series o Géneros)
            try {
                let results = [];
                if (genreId) {
                    // Búsqueda directa por categoría de TMDB
                    const discoverRes = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_genres=${genreId}&sort_by=popularity.desc`);
                    results = discoverRes.data.results;
                } else {
                    // Búsqueda por texto
                    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
                    results = tmdbRes.data.results;
                }

                if (results && results.length > 0) {
                    const bestMatch = genreId ? results[0] : results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                    
                    if (bestMatch) {
                        tmdbId = bestMatch.id;
                        mediaType = bestMatch.media_type || 'movie';
                        tituloOficial = bestMatch.title || bestMatch.name;

                        metadata = {
                            tmdb_id: tmdbId,
                            titulo: tituloOficial,
                            poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                            backdrop: bestMatch.backdrop_path ? `https://image.tmdb.org/t/p/w1280${bestMatch.backdrop_path}` : null,
                            tipo: mediaType,
                            descripcion: bestMatch.overview || "Sin sinopsis disponible.",
                            anio: bestMatch.release_date ? bestMatch.release_date.split('-')[0] : (bestMatch.first_air_date ? bestMatch.first_air_date.split('-')[0] : 'N/A'),
                            rating: bestMatch.vote_average ? bestMatch.vote_average.toFixed(1) : 'N/A'
                        };
                    }
                }
            } catch (tmdbError) {
                console.log("[ZYRO] TMDB falló en búsqueda:", tmdbError.message);
            }

            // 2. METADATA GENÉRICO (Fallback)
            if (!metadata) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null, 
                    backdrop: null,
                    tipo: 'web_search',
                    descripcion: `Resultados universales de la red para: "${query}"`,
                    anio: 'N/A',
                    rating: 'N/A'
                };
            }

            // 3. BUSCAR EN TU MONGODB (Enlaces de comunidad/sala cine)
            const db = getDb();
            if (db && !genreId) { // Evitamos ensuciar búsquedas generales de género con links específicos
                const dbQuery = { 
                    $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] 
                };
                if (tmdbId) {
                    dbQuery.$or.push({ tmdb_id: tmdbId });
                }

                try {
                    const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();
                    customLinks.forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion,
                            calidad: link.calidad,
                            urlDestino: link.urlDestino,
                            categoria: link.categoria || "Comunidad"
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                }
            }

            // 4. PROVEEDORES OFICIALES (TMDB Watch Providers)
            if (tmdbId) {
                try {
                    const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                    const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                    
                    if (ecProviders.flatrate) {
                        ecProviders.flatrate.forEach(provider => {
                            const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                            enlacesFinales.push({
                                sitioWeb: domain,
                                titulo: `Ver en ${provider.provider_name}`,
                                descripcion: `Disponible oficialmente en ${provider.provider_name}. Requiere suscripción.`,
                                calidad: "Premium",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales"
                            });
                        });
                    }
                } catch (providerError) {
                    console.log("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 5. SCRAPING UNIVERSAL INTELIGENTE (DuckDuckGo)
            // Se omite si es una búsqueda puramente de categoría para mantener los resultados limpios
            if (!genreId) {
                try {
                    const userAgents = [
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
                    ];
                    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

                    const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                        headers: {
                            'User-Agent': randomUserAgent,
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                        },
                        timeout: 15000 
                    });

                    const $ = cheerio.load(scraperRes.data);
                    
                    $('.result').each((index, element) => {
                        if (index >= 15) return false; 

                        const rawTitle = $(element).find('.result__title a').text().trim();
                        const rawUrl = $(element).find('.result__title a').attr('href');
                        const snippet = $(element).find('.result__snippet').text().trim();

                        if (rawTitle && rawUrl) {
                            let cleanUrl = rawUrl;
                            if (rawUrl.includes('uddg=')) {
                                try {
                                    const urlObj = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
                                    const uddgParam = urlObj.searchParams.get('uddg');
                                    if (uddgParam) {
                                        cleanUrl = decodeURIComponent(uddgParam);
                                    }
                                } catch (e) {}
                            }

                            if (!cleanUrl.startsWith('http')) return true;

                            let dominio = 'Web';
                            try {
                                dominio = new URL(cleanUrl).hostname.replace('www.', '');
                            } catch (e) {}

                            enlacesFinales.push({
                                sitioWeb: dominio,
                                titulo: rawTitle,
                                descripcion: snippet || 'Resultado de la web abierta.',
                                calidad: 'Web',
                                urlDestino: cleanUrl,
                                categoria: 'Navegación'
                            });
                        }
                    });
                } catch (scrapeError) {
                    console.log(`[ZYRO] Scraping web falló o excedió timeout para "${query}":`, scrapeError.message);
                }
            }

            // 6. EMPAQUETAR Y ENVIAR
            const respuestaFinal = {
                metadata: metadata,
                sugerencias: [], // Mantenemos el array por si a futuro decides enviar recomendaciones locales aquí
                enlaces: enlacesFinales
            };

            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ 
                metadata: { tmdb_id: null, titulo: query || "Error", poster: null, tipo: "error", descripcion: "Hubo un problema procesando la búsqueda." },
                sugerencias: [],
                enlaces: [] 
            });
        }
    });
};
