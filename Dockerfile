# Controlled Linux environment: downloads the seed djinnc, builds the runtime and runs the bootstrap
# (seed -> stage1 -> stage2 -> stage3) with ld.lld and the debug-info tests.
#
#   docker build -t djinn-linux .
#   docker run --rm --cap-add=SYS_PTRACE --security-opt seccomp=unconfined djinn-linux
#                                               # bootstrap with --lld + debug tests (lldb needs ptrace)
#   docker run --rm djinn-linux bash            # interactive shell
FROM ubuntu:24.04

ARG LLVM_VERSION=21
ARG SEED_URL=https://github.com/IDjinn/djinn-lang-v3/releases/download/stage0-final/djinnc-linux-x64
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        wget gnupg ca-certificates git rsync build-essential \
        libxml2-dev zlib1g-dev libzstd-dev libffi-dev python3 \
    && wget -qO /etc/apt/trusted.gpg.d/apt.llvm.org.asc https://apt.llvm.org/llvm-snapshot.gpg.key \
    && echo "deb http://apt.llvm.org/noble/ llvm-toolchain-noble-${LLVM_VERSION} main" > /etc/apt/sources.list.d/llvm.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        clang-${LLVM_VERSION} lld-${LLVM_VERSION} llvm-${LLVM_VERSION}-dev libclang-rt-${LLVM_VERSION}-dev lldb-${LLVM_VERSION} \
    && ln -sf /usr/bin/clang-${LLVM_VERSION} /usr/local/bin/clang \
    && ln -sf /usr/bin/clang++-${LLVM_VERSION} /usr/local/bin/clang++ \
    && ln -sf /usr/bin/ld.lld-${LLVM_VERSION} /usr/local/bin/ld.lld \
    && ln -sf /usr/bin/llvm-ar-${LLVM_VERSION} /usr/local/bin/llvm-ar \
    && ln -sf /usr/bin/lldb-${LLVM_VERSION} /usr/local/bin/lldb \
    && rm -rf /var/lib/apt/lists/*

ENV LLVM_VERSION=${LLVM_VERSION}

WORKDIR /work
COPY . /work

RUN sed -i "s|'-LC:/dev/llvm-[^']*',|'-L/usr/lib/llvm-${LLVM_VERSION}/lib',|; s|'-lLLVM-C'|'-lLLVM-${LLVM_VERSION}'|" djinnc/djinn.proj \
    && mkdir -p /opt/djinn \
    && wget -qO /opt/djinn/djinnc "${SEED_URL}" && chmod +x /opt/djinn/djinnc \
    && bash tools/build_runtime.sh --out /opt/djinn/runtime-lib \
    && cp -r runtime /opt/djinn/runtime

CMD ["bash", "docker/run.sh"]
