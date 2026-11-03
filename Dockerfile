# star-map image, served under /star-map/ behind the projects.avalonvanguard.com gateway,
# which passes the path through as is and sets the security headers and compression.

# Angular build under /star-map/ (asset paths are relative to <base>)
FROM node:22-alpine AS build
WORKDIR /src
# .npmrc: the @avalon-vanguard scope (shared config) comes from the Gitea registry, readable without a token
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build -- --base-href /star-map/

FROM nginx:1.31-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/star-map/browser/ /usr/share/nginx/html/star-map/
