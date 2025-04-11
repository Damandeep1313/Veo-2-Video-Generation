# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code and static files
COPY . .

# Ensure videos directory exists and is writable
RUN mkdir -p /app/videos && chmod -R 777 /app/videos

# Expose the port your server runs on (change if different)
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
