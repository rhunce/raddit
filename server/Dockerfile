FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --omit=dev

# Bundle app source
COPY . .
COPY .env.production .env

# Build bundled app source code from above
RUN npm run build

ENV NODE_ENV production

EXPOSE 8080
CMD [ "node", "dist/index.js" ]

# By default, Docker runs commands inside the container as root which violates the 
# Principle of Least Privilege (PoLP) when superuser permissions are not strictly 
# required. You want to run the container as an unprivileged user whenever possible. 
# The node images provide the node user for such purpose.
USER node