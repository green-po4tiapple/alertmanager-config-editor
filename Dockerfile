# Static files behind nginx — for anyone who wants this hosted next to their own
# Alertmanager rather than on public GitHub Pages. One practical upside: a page
# served over plain HTTP may talk to http:// endpoints, which a browser blocks from
# an HTTPS page as mixed content.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
