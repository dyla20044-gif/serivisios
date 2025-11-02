# 1. Usamos una imagen base oficial de Playwright. 
# Esta imagen ya incluye Node.js, Chromium, y todas las dependencias de sistema necesarias.
FROM mcr.microsoft.com/playwright:v1.45.3-jammy

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
