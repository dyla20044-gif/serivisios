# 1. Usamos una imagen base oficial de Playwright.
FROM mcr.microsoft.com/playwright:v1.45.3-jammy

# === INICIO DE MODIFICACIÓN V4 (Doble Instalación) ===
# 1.A. Cambiamos a usuario ROOT para poder instalar paquetes
USER root

# 1.B. Instalar 'python3-pip' (para el método 1) y 'curl' (para el método 2)
RUN apt-get update && \
    apt-get install -y python3-pip curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# 1.C. MÉTODO 1: Instalar con pip3
#    Esto debería ponerlo en el PATH correcto.
RUN pip3 install --no-cache-dir yt-dlp

# 1.D. MÉTODO 2: Descarga directa (Por si pip falla)
#    Esto FUERZA el archivo a estar en /usr/local/bin/yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# 1.E. Volvemos al usuario no-root 'pwuser'
USER pwuser
# === FIN DE MODIFICACIÓN V4 ===

# 2. Configura el directorio de trabajo
WORKDIR /usr/src/app/ala-cine-backend

# 3. Copia los archivos de configuración
COPY ala-cine-backend/package.json .
COPY ala-cine-backend/package-lock.json .

# 4. Instala las dependencias de Node
RUN npm install

# 5. Copia el resto de tu código
COPY ala-cine-backend/ .
# 6. Expone el puerto
EXPOSE 3000

# 7. Comando para iniciar la aplicación
CMD [ "npm", "start" ]
