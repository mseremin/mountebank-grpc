FROM node:14.15.4-slim
CMD ["node"]
ENV MOUNTEBANK_VERSION=2.6.0
RUN npm -g config set user root
RUN npm install -g mountebank@${MOUNTEBANK_VERSION} --production

# установка зависимостей
# символ астериск ("*") используется для того чтобы по возможности
# скопировать оба файла: package.json и package-lock.json
COPY package*.json ./

RUN npm install
# Если вы создаете сборку для продакшн
# RUN npm ci --only=production

# копируем исходный код
COPY . .

RUN npm cache clean -f
EXPOSE 2525
ENTRYPOINT ["mb"]
CMD ["start", "--protofile", "/protocols.json"]
