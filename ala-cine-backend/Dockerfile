# 1. Usamos una imagen base oficial de Playwright. 
# Esta imagen ya incluye Node.js, Chromium, y todas las dependencias de sistema necesarias.
FROM mcr.microsoft.com/playwright:v1.45.3-jammy

# === INICIO DE MODIFICACIÓN V2 (Método Oficial) ===
# 1.A. Cambiamos a usuario ROOT para poder instalar paquetes
USER root

# 1.B. Instalamos 'curl' (para descargar) y 'ca-certificates' (para HTTPS)
#      (La imagen de Playwright ya los debería tener, pero esto asegura)
RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# 1.C. Descargamos el binario de yt-dlp directamente a /usr/local/bin
#      Esta es la forma recomendada por yt-dlp para sistemas Linux
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp

# 1.D. Le damos permisos de ejecución para que el servidor pueda usarlo
RUN chmod a+rx /usr/local/bin/yt-dlp

# 1.E. Volvemos al usuario no-root 'pwuser' que usa la imagen de Playwright por defecto
USER pwuser
# === FIN DE MODIFICACIÓN V2 ===


# 2. Configura el directorio de trabajo dentro del contenedor (el equivalente a tu Root Directory)
WORKDIR /usr/src/app/ala-cine-backend

# 3. Copia los archivos de configuración
# Copiamos package.json y package-lock.json (asegúrate de que estén en la misma carpeta)
COPY ala-cine-backend/package.json .
COPY ala-cine-backend/package-lock.json .

# 4. Instala las dependencias de Node (las que están en tu package.json)
# El navegador Playwright ya está instalado en la imagen base.
RUN npm install

# 5. Copia el resto de tu código de aplicación (server.js, m3u8Extractor.js, bot.js, etc.)
COPY ala-cine-backend/ .
# 6. Expone el puerto donde corre tu servidor (por defecto, 3000 si no lo cambiaste en .env)
EXPOSE 3000

# 7. Comando para iniciar la aplicación
CMD [ "npm", "start" ]
