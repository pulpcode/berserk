FROM python:3.12.11-slim-bookworm

ARG DEBIAN_MIRROR=https://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    bash nodejs ripgrep fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /opt/berserk/requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" -r /opt/berserk/requirements.txt
COPY files.py command.py /opt/berserk/
RUN chmod 0555 /opt/berserk /opt/berserk/files.py /opt/berserk/command.py \
    && mkdir /workspace /logs
ENV HOME=/tmp LANG=C.UTF-8 PYTHONDONTWRITEBYTECODE=1 MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /workspace
USER 1000:1000
CMD ["sleep", "infinity"]
