# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Baked into the JS bundle at build time (Vite envs are compile-time).
# Since the browser — not another container — makes these calls, this must
# be a host-reachable URL (e.g. http://localhost:8000), not a Docker
# service name like http://backend:8000.
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# --- serve stage ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
