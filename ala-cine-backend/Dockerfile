# === INICIO DE MODIFICACIÓN V6 (Imagen Completa + Python) ===

# 1. Usar una imagen oficial de Node.js v18 (Completa, no 'slim')
#    Esto nos da un entorno Debian "Bullseye" completo y predecible.
FROM node:18-bullseye

# 2. Cambiar a usuario ROOT para instalar paquetes del sistema
USER root

# 3. Instalar Python3 y PIP (necesarios para yt-dlp)
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# 4. Instalar yt-dlp usando PIP
#    Esta es la forma más fiable.
RUN pip3 install --no-cache-dir yt-dlp

# 5. Configura el directorio de trabajo
WORKDIR /usr/src/app

# 6. Copia los archivos de configuración
#    (CORREGIDO: Se quitó 'ala-cine-backend/')
COPY package.json .
COPY package-lock.json .

# 7. Instala las dependencias de Node
RUN npm install

# 8. Copia el resto de tu código de aplicación
#    (CORREGIDO: Se quitó 'ala-cine-backend/')
COPY . .

# 9. Expone el puerto
EXPOSE 3000

# 10. Comando para iniciar la aplicación
CMD [ "npm", "start" ]

# === FIN DE MODIFICACIÓN V6 ===
