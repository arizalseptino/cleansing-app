FROM node:20-slim

WORKDIR /app

# Install Python 3, venv, pip, and minimal system dependencies for ETL packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       python3-venv \
       python3-pip \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies (use npm ci if package-lock.json exists, fallback to npm install)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi

# Create Python virtual environment and install ETL dependencies
COPY python-etl/requirements.txt ./python-etl/requirements.txt
RUN python3 -m venv /app/python-etl/.venv \
    && /app/python-etl/.venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/python-etl/.venv/bin/pip install --no-cache-dir -r /app/python-etl/requirements.txt

# Copy project source code (including python-etl & reference CSVs) and build Nuxt app
COPY . .
RUN npm run build

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production \
    PYTHONIOENCODING=utf-8 \
    PYTHONUTF8=1

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
