# Build from the existing runtime only after verifying its recorded image digest.
FROM berserk-file-runtime:w01-5
USER root
RUN pip install --no-cache-dir --index-url https://pypi.org/simple semgrep==1.182.0 \
    && mkdir -p /input /rules
ENV HOME=/tmp LANG=C.UTF-8 SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
WORKDIR /input
USER 1000:1000
