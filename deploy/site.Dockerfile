# L'archive téléchargeable est générée ici, depuis le code du repo : le site sert toujours la dernière version.
FROM alpine:3.20 AS pkg
WORKDIR /src
COPY bin ./tchat/bin
COPY lib ./tchat/lib
COPY shell ./tchat/shell
COPY package.json README.md install.sh ./tchat/
RUN chmod +x tchat/bin/tchat.js && tar -czf /tchat.tar.gz tchat

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
COPY install.sh /usr/share/nginx/html/install.sh
COPY --from=pkg /tchat.tar.gz /usr/share/nginx/html/tchat.tar.gz
EXPOSE 8080
