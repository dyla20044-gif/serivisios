const axios = require('axios');
const cheerio = require('cheerio'); 

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // 1. NUEVO ENDPOINT: Para cargar el Home de la App (Estrenos)
    app.get('/api/zyro-home', async (req, res) => {
        const cacheKey = 'zyro_home_estrenos';
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) return res.json(cachedResult);

        try {
            // Buscamos las películas actualmente en cines usando TMDB
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=es-ES&page=1`);
            
            const estrenos = tmdbRes.data.results.slice(0, 10).map(movie => ({
                id: movie.id,
                titulo: movie.title,
                // Extraemos el año de la fecha de lanzamiento para el subtitulo
                subtitulo: movie.release_date ? movie.release_date.substring(0, 4) : '2026',
                posterPath: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Imagen'
            }));

            cache.set(cacheKey, estrenos, 3600); // Guardar en caché 1 hora
            res.json(estrenos);
        } catch (error) {
            console.error("[ZYRO] Error obteniendo estrenos:", error.message);
            res.status(500).json([]);
        }
    });

    // 2. ENDPOINT PRINCIPAL: Búsqueda y Categorías
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        const queryLower = query.toLowerCase().trim();
        const cacheKey = `zyro_universal_${queryLower}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${query}`);
            return res.json(cachedResult);
        }

        try {
            // A. INTERCEPTAR BÚSQUEDAS POR CATEGORÍA
            const generosMap = {
                "acción": 28, "ciencia ficción": 878, "terror": 27, 
                "comedia": 35, "drama": 18, "animación": 16
            };

            if (queryLower.startsWith("películas de ")) {
                const generoStr = queryLower.replace("películas de ", "").trim();
                const genreId = generosMap[generoStr];

                if (genreId) {
                    // Buscar en TMDB por género
                    const discoverRes = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_genres=${genreId}&sort_by=popularity.desc`);
                    
                    const sugerencias = discoverRes.data.results.slice(0, 15).map(m => ({
                        imagen: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750',
                        titulo: m.title,
                        anio: m.release_date ? m.release_date.substring(0, 4) : ''
                    }));

                    const respuestaCategoria = {
                        metadata: {
                            titulo: `Explorando: ${generoStr.toUpperCase()}`,
                            descripcion: `Las mejores películas de ${generoStr} seleccionadas para ti.`,
                            poster: null,
                            tipo: "category"
                        },
                        sugerencias: sugerencias,
                        enlaces: []
                    };
                    cache.set(cacheKey, respuestaCategoria, 3600);
                    return res.json(respuestaCategoria);
                }
            }

            // B. FLUJO NORMAL DE BÚSQUEDA UNIVERSAL
            let metadata = null;
            let enlacesFinales = [];
            let tmdbId = null;
            let mediaType = 'movie';
            let tituloOficial = query;
            let sugerenciasAsociadas = [];

            // Buscar en TMDB para Metadata
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
                const results = tmdbRes.data.results;

                if (results && results.length > 0) {
                    const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                    if (bestMatch) {
                        tmdbId = bestMatch.id;
                        mediaType = bestMatch.media_type || 'movie';
                        tituloOficial = bestMatch.title || bestMatch.name;

                        metadata = {
                            tmdb_id: tmdbId,
                            titulo: tituloOficial,
                            poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                            tipo: mediaType,
                            descripcion: bestMatch.overview || "Sin sinopsis disponible."
                        };

                        // Obtener sugerencias similares basadas en esta película/serie
                        const similarRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/similar?api_key=${TMDB_API_KEY}&language=es-ES`);
                        sugerenciasAsociadas = similarRes.data.results.slice(0, 6).map(m => ({
                            imagen: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750',
                            titulo: m.title || m.name,
                            anio: (m.release_date || m.first_air_date || '').substring(0, 4)
                        }));
                    }
                }
            } catch (tmdbError) {
                console.log("[ZYRO] TMDB falló:", tmdbError.message);
            }

            if (!metadata) {
                metadata = { tmdb_id: null, titulo: query, poster: null, tipo: 'web_search', descripcion: `Resultados universales de la red para: "${query}"` };
            }

            // Buscar en tu MongoDB
            const db = getDb();
            if (db) {
                const dbQuery = { $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] };
                if (tmdbId) dbQuery.$or.push({ tmdb_id: tmdbId });

                try {
                    const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();
                    customLinks.forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb, titulo: link.titulo, descripcion: link.descripcion,
                            calidad: link.calidad, urlDestino: link.urlDestino, categoria: link.categoria || "Comunidad"
                        });
                    });
                } catch(dbErr) { console.error("[ZYRO] Error BD:", dbErr.message); }
            }

            // Proveedores Oficiales
            if (tmdbId) {
                try {
                    const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                    const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                    if (ecProviders.flatrate) {
                        ecProviders.flatrate.forEach(provider => {
                            const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                            enlacesFinales.push({
                                sitioWeb: domain, titulo: `Ver en ${provider.provider_name}`,
                                descripcion: `Disponible oficialmente en ${provider.provider_name}.`,
                                calidad: "Premium", urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales"
                            });
                        });
                    }
                } catch (providerError) {}
            }

            // Scraping DuckDuckGo (Universal)
            try {
                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
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
                                if (uddgParam) cleanUrl = decodeURIComponent(uddgParam);
                            } catch (e) {}
                        }
                        if (!cleanUrl.startsWith('http')) return true;
                        let dominio = 'Web';
                        try { dominio = new URL(cleanUrl).hostname.replace('www.', ''); } catch (e) {}

                        enlacesFinales.push({
                            sitioWeb: dominio, titulo: rawTitle, descripcion: snippet || 'Resultado de la web abierta.',
                            calidad: 'Web', urlDestino: cleanUrl, categoria: 'Navegación'
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] Scraping falló para "${query}"`);
            }

            const respuestaFinal = {
                metadata: metadata,
                sugerencias: sugerenciasAsociadas, // Añadimos sugerencias dinámicas basadas en la búsqueda
                enlaces: enlacesFinales
            };

            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico:", error);
            res.status(500).json({ metadata: { tmdb_id: null, titulo: query, tipo: "error", descripcion: "Error procesando búsqueda." }, enlaces: [] });
        }
    });
};
