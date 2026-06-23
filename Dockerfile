FROM node:24-alpine
WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

EXPOSE 5188

# Run vite directly with node – avoids the npm shell-script wrapper
CMD ["node", "node_modules/vite/bin/vite.js"]
