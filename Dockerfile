# Controlled Linux environment: builds the stage0 compiler, runs the bootstrap
# (stage0 -> stage1 -> stage2 -> stage3) with ld.lld and the debug-info tests.
#
#   docker build -t djinn-linux .
#   docker run --rm --cap-add=SYS_PTRACE --security-opt seccomp=unconfined djinn-linux
#                                               # bootstrap with --lld + debug tests (lldb needs ptrace)
#   docker run --rm djinn-linux bash            # interactive shell
FROM ubuntu:24.04

ARG LLVM_VERSION=21
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        wget gnupg ca-certificates git cmake ninja-build rsync build-essential g++-14 libstdc++-14-dev \
        libxml2-dev zlib1g-dev libzstd-dev libffi-dev python3 \
    && wget -qO /etc/apt/trusted.gpg.d/apt.llvm.org.asc https://apt.llvm.org/llvm-snapshot.gpg.key \
    && echo "deb http://apt.llvm.org/noble/ llvm-toolchain-noble-${LLVM_VERSION} main" > /etc/apt/sources.list.d/llvm.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        clang-${LLVM_VERSION} lld-${LLVM_VERSION} llvm-${LLVM_VERSION}-dev libclang-rt-${LLVM_VERSION}-dev lldb-${LLVM_VERSION} \
    && ln -sf /usr/bin/clang-${LLVM_VERSION} /usr/local/bin/clang \
    && ln -sf /usr/bin/clang++-${LLVM_VERSION} /usr/local/bin/clang++ \
    && ln -sf /usr/bin/ld.lld-${LLVM_VERSION} /usr/local/bin/ld.lld \
    && ln -sf /usr/bin/lldb-${LLVM_VERSION} /usr/local/bin/lldb \
    && rm -rf /var/lib/apt/lists/*

ENV LLVM_VERSION=${LLVM_VERSION}

WORKDIR /work
COPY . /work

# /build is a BuildKit cache mount: ninja only recompiles what changed between builds.
# Cache mounts are not part of the image, so the artifacts are copied to /opt/djinn.
RUN --mount=type=cache,target=/build,id=djinn-build     sed -i "s|'-LC:/dev/llvm-[^']*',|'-L/usr/lib/llvm-${LLVM_VERSION}/lib',|; s|'-lLLVM-C'|'-lLLVM-${LLVM_VERSION}'|" djinnc/djinn.proj     && cmake -S . -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release         -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++         -DLLVM_DIR=/usr/lib/llvm-${LLVM_VERSION}/lib/cmake/llvm     && cmake --build /build --target djinn djinn_runtime     && mkdir -p /opt/djinn     && cp /build/djinn /opt/djinn/djinn     && cp -r /build/runtime /opt/djinn/runtime     && cp "$(find /build -maxdepth 2 -name 'libdjinn_runtime.a' | head -1)" /opt/djinn/libdjinn_runtime.a

CMD ["bash", "docker/run.sh"]
