ARG ZEPHYR_DOCKER_TAG=v0.29.2
FROM ghcr.io/zephyrproject-rtos/zephyr-build:${ZEPHYR_DOCKER_TAG}

ARG ZEPHYR_VERSION=v4.4.0

ENV ZEPHYR_BASE=/opt/zephyrproject/zephyr \
    BOARD=spaghettilab_core_v1/esp32c3 \
    CCACHE_DIR=/home/user/.cache/ccache

# Keep the complete, versioned Zephyr workspace in the image. The application
# is mounted below this directory so west can discover its extension commands.
USER root

RUN mkdir -p /opt/zephyrproject/app "${CCACHE_DIR}" \
    && chown -R user:user /opt/zephyrproject /home/user/.cache

USER user

# Keep network-heavy operations in separate layers. Successful layers remain
# cached, and west update can resume partial repositories during its retries.
RUN git config --global http.version HTTP/1.1 \
    && west init -m https://github.com/zephyrproject-rtos/zephyr \
        --mr "${ZEPHYR_VERSION}" /opt/zephyrproject

RUN cd /opt/zephyrproject \
    && for attempt in 1 2 3; do \
        if west update --narrow; then break; fi; \
        if [ "${attempt}" -eq 3 ]; then exit 1; fi; \
        echo "west update failed; retry ${attempt}/3"; \
        sleep $((attempt * 5)); \
    done

USER root

# The base image's shared Python virtual environment is owned by root.
RUN git config --global --add safe.directory '*' \
    && cd /opt/zephyrproject \
    && for attempt in 1 2 3; do \
        if west packages pip --install; then break; fi; \
        if [ "${attempt}" -eq 3 ]; then exit 1; fi; \
        echo "Python package installation failed; retry ${attempt}/3"; \
        sleep $((attempt * 5)); \
    done

USER user

RUN cd /opt/zephyrproject \
    && for attempt in 1 2 3; do \
        if west blobs fetch hal_espressif; then break; fi; \
        if [ "${attempt}" -eq 3 ]; then exit 1; fi; \
        echo "Espressif blob download failed; retry ${attempt}/3"; \
        sleep $((attempt * 5)); \
    done \
    && west zephyr-export

WORKDIR /opt/zephyrproject/app

CMD ["/bin/bash"]
