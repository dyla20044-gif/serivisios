# 1. Usamos una imagen base oficial de Playwright.
FROM mcr.microsoft.com/playwright:v1.45.3-jammy

# === INICIO DE MODIFICACIÓN V3 (Método Python/pip) ===
# 1.A. Cambiamos a usuario ROOT para poder instalar paquetes
USER root

# 1.B. Actualizar e instalar el gestor de paquetes de Python (pip)
#      La imagen ya trae python3, pero no siempre trae pip3.
RUN apt-get update && \
    apt-get install -y python3-pip && \
    rm -rf /var/lib/apt/lists/*

# 1.C. Instalar yt-dlp usando pip
#    Esta es la forma más fiable y pondrá 'yt-dlp' en el PATH del sistema.
RUN pip3 install --no-cache-dir yt-dlp

# 1.D. Volvemos al usuario no-root 'pwuser' que usa la imagen por defecto
USER pwuser
# === FIN DE MODIFICACIÓN V3 ===


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
