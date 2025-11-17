# === INICIO DE MODIFICACIÓN V5 (Imagen Estándar) ===

# 1. Usar una imagen oficial de Node.js v18 (LTS - Estable)
FROM node:18-bullseye-slim

# 2. Cambiar a usuario ROOT para instalar paquetes del sistema
USER root

# 3. Instalar Python3 y PIP (necesarios para yt-dlp)
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# 4. Instalar yt-dlp usando PIP
#    Esta es la forma más fiable y lo instala en el PATH del sistema.
RUN pip3 install --no-cache-dir yt-dlp

# 5. Configura el directorio de trabajo
WORKDIR /usr/src/app

# 6. Copia los archivos de configuración
#    (Ajustado a la nueva estructura de WORKDIR)
COPY ala-cine-backend/package.json .
COPY ala-cine-backend/package-lock.json .

# 7. Instala las dependencias de Node
RUN npm install

# 8. Copia el resto de tu código de aplicación
COPY ala-cine-backend/ .

# 9. Expone el puerto
EXPOSE 3000

# 10. Comando para iniciar la aplicación
CMD [ "npm", "start" ]

# === FIN DE MODIFICACIÓN V5 ===
