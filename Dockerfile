# Image de star-map, servie sous /star-map/ derrière la passerelle projects.avalonvanguard.com,
# qui transmet le chemin tel quel et pose les en-têtes de sécurité et la compression.

# Build Angular sous /star-map/ (les chemins des ressources sont relatifs à <base>)
FROM node:22-alpine AS build
WORKDIR /src
# .npmrc : le scope @avalon-vanguard (config partagée) vient du registre Gitea, lisible sans jeton
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build -- --base-href /star-map/

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/star-map/browser/ /usr/share/nginx/html/star-map/
