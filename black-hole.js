/* Adapted for preetham.org from the WebGL/ASCII black-hole renderer at stevensarmi.com. */
(() => {
  const ROOT_ID = "pk-black-hole";
  const GLYPHS = " .,:;-=+*#%@|/\\0<>";
  const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const vertexShader = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 pos;
  if (gl_VertexID == 0) pos = vec2(-1.0, -1.0);
  else if (gl_VertexID == 1) pos = vec2(3.0, -1.0);
  else pos = vec2(-1.0, 3.0);
  vUv = 0.5 * (pos + 1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

  const raytraceShader = `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uRs;
uniform float uStepSize;
uniform float uEscapeRadius;
uniform int uMaxSteps;
uniform float uDiskR1;
uniform float uDiskR2;
uniform int uNumObjects;
uniform vec4 uObjPosRadius[16];
uniform vec4 uObjColor[16];

struct Ray {
  float x; float y; float z; float r; float theta; float phi;
  float dr; float dtheta; float dphi; float E; float L;
};

Ray initRay(vec3 pos, vec3 dir) {
  Ray ray;
  ray.x = pos.x; ray.y = pos.y; ray.z = pos.z; ray.r = length(pos);
  float zOverR = ray.r > 0.0 ? pos.z / ray.r : 0.0;
  ray.theta = acos(clamp(zOverR, -1.0, 1.0));
  ray.phi = atan(pos.y, pos.x);
  float sinTheta = max(sin(ray.theta), 1e-6);
  float cosTheta = cos(ray.theta);
  float sinPhi = sin(ray.phi);
  float cosPhi = cos(ray.phi);
  float dx = dir.x; float dy = dir.y; float dz = dir.z;
  ray.dr = sinTheta * cosPhi * dx + sinTheta * sinPhi * dy + cosTheta * dz;
  ray.dtheta = (cosTheta * cosPhi * dx + cosTheta * sinPhi * dy - sinTheta * dz) / max(ray.r, 1e-6);
  ray.dphi = (-sinPhi * dx + cosPhi * dy) / max(ray.r * sinTheta, 1e-6);
  ray.L = ray.r * ray.r * sinTheta * ray.dphi;
  float f = 1.0 - uRs / max(ray.r, 1e-6);
  float dt = sqrt((ray.dr * ray.dr) / max(f, 1e-6) + ray.r * ray.r * (ray.dtheta * ray.dtheta + sinTheta * sinTheta * ray.dphi * ray.dphi));
  ray.E = f * dt;
  return ray;
}

bool interceptObject(Ray ray, out vec4 objectColor, out vec3 hitCenter) {
  vec3 point = vec3(ray.x, ray.y, ray.z);
  for (int i = 0; i < 16; ++i) {
    if (i >= uNumObjects) break;
    vec3 center = uObjPosRadius[i].xyz;
    if (distance(point, center) <= uObjPosRadius[i].w) {
      objectColor = uObjColor[i]; hitCenter = center; return true;
    }
  }
  objectColor = vec4(0.0); hitCenter = vec3(0.0); return false;
}

void geodesicRHS(Ray ray, out vec3 d1, out vec3 d2) {
  float r = ray.r; float theta = ray.theta; float dr = ray.dr;
  float dtheta = ray.dtheta; float dphi = ray.dphi;
  float sinTheta = max(sin(theta), 1e-6); float cosTheta = cos(theta);
  float f = 1.0 - uRs / max(r, 1e-6);
  float dt = ray.E / max(f, 1e-6);
  d1 = vec3(dr, dtheta, dphi);
  d2.x = -(uRs / (2.0 * r * r)) * f * dt * dt
    + (uRs / (2.0 * r * r * max(f, 1e-6))) * dr * dr
    + r * (dtheta * dtheta + sinTheta * sinTheta * dphi * dphi);
  d2.y = -2.0 * dr * dtheta / max(r, 1e-6) + sinTheta * cosTheta * dphi * dphi;
  d2.z = -2.0 * dr * dphi / max(r, 1e-6) - 2.0 * cosTheta / sinTheta * dtheta * dphi;
}

void stepRay(inout Ray ray, float stepSize) {
  vec3 velocity; vec3 acceleration;
  geodesicRHS(ray, velocity, acceleration);
  ray.r += stepSize * velocity.x;
  ray.theta += stepSize * velocity.y;
  ray.phi += stepSize * velocity.z;
  ray.dr += stepSize * acceleration.x;
  ray.dtheta += stepSize * acceleration.y;
  ray.dphi += stepSize * acceleration.z;
  float sinTheta = sin(ray.theta); float cosTheta = cos(ray.theta);
  float cosPhi = cos(ray.phi); float sinPhi = sin(ray.phi);
  ray.x = ray.r * sinTheta * cosPhi;
  ray.y = ray.r * sinTheta * sinPhi;
  ray.z = ray.r * cosTheta;
}

bool crossesDisk(vec3 oldPos, vec3 newPos) {
  float radius = length(vec2(newPos.x, newPos.z));
  return oldPos.y * newPos.y < 0.0 && radius >= uDiskR1 && radius <= uDiskR2;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float u = (2.0 * frag.x / uResolution.x - 1.0) * uAspect * uTanHalfFov;
  float v = (1.0 - 2.0 * frag.y / uResolution.y) * uTanHalfFov;
  vec3 dir = normalize(u * uCamRight - v * uCamUp + uCamForward);
  Ray ray = initRay(uCamPos, dir);
  vec3 previous = vec3(ray.x, ray.y, ray.z);
  bool hitHole = false; bool hitDisk = false; bool hitObject = false;
  vec4 objectColor = vec4(0.0); vec3 hitCenter = vec3(0.0);
  int stepIndex = 0; bool stop = false;

  for (int outer = 0; outer < 2000; ++outer) {
    for (int inner = 0; inner < 8; ++inner) {
      if (stepIndex >= uMaxSteps) { stop = true; break; }
      if (ray.r <= uRs) { hitHole = true; stop = true; break; }
      stepRay(ray, uStepSize); stepIndex += 1;
      vec3 current = vec3(ray.x, ray.y, ray.z);
      if (crossesDisk(previous, current)) { hitDisk = true; stop = true; break; }
      if (interceptObject(ray, objectColor, hitCenter)) { hitObject = true; stop = true; break; }
      previous = current;
      if (ray.r > uEscapeRadius) { stop = true; break; }
    }
    if (stop) break;
  }

  vec4 color = vec4(0.0);
  if (hitDisk) {
    float radial = length(vec3(ray.x, ray.y, ray.z)) / uDiskR2;
    color = vec4(vec3(1.0, radial, 0.2), radial);
  } else if (hitHole) {
    color = vec4(0.0, 0.0, 0.0, 1.0);
  } else if (hitObject) {
    vec3 point = vec3(ray.x, ray.y, ray.z);
    vec3 normal = normalize(point - hitCenter);
    vec3 view = normalize(uCamPos - point);
    float intensity = 0.1 + 0.9 * max(dot(normal, view), 0.0);
    color = vec4(objectColor.rgb * intensity, objectColor.a);
  }
  outColor = color;
}`;

  const blitShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTexture;
void main() { outColor = texture(uTexture, vUv); }`;

  const gridVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

  const gridFragmentShader = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.5, 0.5, 0.5, 0.7); }`;

  const compileShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };

  const createProgram = (gl, vertex, fragment) => {
    const program = gl.createProgram();
    const vertexObject = compileShader(gl, gl.VERTEX_SHADER, vertex);
    const fragmentObject = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
    if (!program) throw new Error("Unable to create WebGL program");
    gl.attachShader(program, vertexObject);
    gl.attachShader(program, fragmentObject);
    gl.linkProgram(program);
    gl.deleteShader(vertexObject);
    gl.deleteShader(fragmentObject);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Program link failed";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  };

  const normalize = (out, x, y, z) => {
    const length = Math.hypot(x, y, z) || 1;
    out[0] = x / length; out[1] = y / length; out[2] = z / length;
  };

  const cross = (out, ax, ay, az, bx, by, bz) => {
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
  };

  const mount = () => {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement("div");
    const sourceCanvas = document.createElement("canvas");
    const asciiCanvas = document.createElement("canvas");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    sourceCanvas.className = "pk-black-hole-source";
    asciiCanvas.className = "pk-black-hole-ascii";
    root.append(sourceCanvas, asciiCanvas);
    document.body.prepend(root);

    const gl = sourceCanvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false,
    });
    const ascii = asciiCanvas.getContext("2d", { alpha: false });
    const samplerCanvas = document.createElement("canvas");
    const sampler = samplerCanvas.getContext("2d", { willReadFrequently: true });
    if (!gl || !ascii || !sampler) {
      root.remove();
      return;
    }

    let rayProgram;
    let blitProgram;
    let gridProgram;
    try {
      rayProgram = createProgram(gl, vertexShader, raytraceShader);
      blitProgram = createProgram(gl, vertexShader, blitShader);
      gridProgram = createProgram(gl, gridVertexShader, gridFragmentShader);
    } catch (error) {
      console.warn("Black-hole renderer unavailable:", error);
      root.remove();
      return;
    }

    const fullscreenVao = gl.createVertexArray();
    gl.bindVertexArray(fullscreenVao);

    const gridVertices = new Float32Array(2028);
    let vertexOffset = 0;
    for (let row = 0; row <= 25; row += 1) {
      for (let column = 0; column <= 25; column += 1) {
        const x = (column - 12.5) * 1e10;
        const z = (row - 12.5) * 1e10;
        const radius = Math.hypot(x, z);
        const y = radius > 1.269e10
          ? 2 * Math.sqrt(1.269e10 * (radius - 1.269e10)) - 3e10
          : 2 * 1.269e10 - 3e10;
        gridVertices.set([x, y, z], vertexOffset);
        vertexOffset += 3;
      }
    }

    const gridIndices = new Uint16Array(2500);
    let indexOffset = 0;
    for (let row = 0; row < 25; row += 1) {
      for (let column = 0; column < 25; column += 1) {
        const index = row * 26 + column;
        gridIndices.set([index, index + 1, index, index + 26], indexOffset);
        indexOffset += 4;
      }
    }

    const gridVao = gl.createVertexArray();
    const gridVbo = gl.createBuffer();
    const gridEbo = gl.createBuffer();
    gl.bindVertexArray(gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
    gl.bufferData(gl.ARRAY_BUFFER, gridVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridEbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndices, gl.STATIC_DRAW);

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const internalWidth = 130;
    const internalHeight = 98;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, internalWidth, internalHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const uniform = (program, name) => gl.getUniformLocation(program, name);
    const rayUniforms = {
      resolution: uniform(rayProgram, "uResolution"), camPos: uniform(rayProgram, "uCamPos"),
      camRight: uniform(rayProgram, "uCamRight"), camUp: uniform(rayProgram, "uCamUp"),
      camForward: uniform(rayProgram, "uCamForward"), tanHalfFov: uniform(rayProgram, "uTanHalfFov"),
      aspect: uniform(rayProgram, "uAspect"), rs: uniform(rayProgram, "uRs"),
      stepSize: uniform(rayProgram, "uStepSize"), escapeRadius: uniform(rayProgram, "uEscapeRadius"),
      maxSteps: uniform(rayProgram, "uMaxSteps"), diskR1: uniform(rayProgram, "uDiskR1"),
      diskR2: uniform(rayProgram, "uDiskR2"), numObjects: uniform(rayProgram, "uNumObjects"),
      objectPositions: uniform(rayProgram, "uObjPosRadius[0]"), objectColors: uniform(rayProgram, "uObjColor[0]"),
    };
    const blitTexture = uniform(blitProgram, "uTexture");
    const gridViewProjection = uniform(gridProgram, "uViewProj");

    const objectPositions = new Float32Array(64);
    const objectColors = new Float32Array(64);
    objectPositions.set([4e11, 0, 0, 4e10], 0);
    objectColors.set([1, 1, 0, 1], 0);
    objectPositions.set([0, 0, 4e11, 4e10], 4);
    objectColors.set([1, 0, 0, 1], 4);

    const camera = {
      position: new Float32Array(3), right: new Float32Array(3),
      up: new Float32Array(3), forward: new Float32Array(3),
      tanHalfFov: Math.tan(Math.PI / 6), aspect: 1,
    };
    const temporaryA = new Float32Array(3);
    const temporaryB = new Float32Array(3);
    let azimuth = 1.661461;
    const baseElevation = 1.452789;
    let pointerAzimuth = 0;
    let pointerElevation = 0;
    let targetPointerAzimuth = 0;
    let targetPointerElevation = 0;
    const cameraRadius = 1.35e11;
    let viewportWidth = 1;
    let viewportHeight = 1;
    let columns = 1;
    let rows = 1;
    let cellWidth = 1;
    let cellHeight = 1;
    let animationFrame = 0;
    let lastFrame = 0;

    const updateCamera = () => {
      const cameraAzimuth = azimuth + pointerAzimuth;
      const cameraElevation = baseElevation + pointerElevation;
      const sinElevation = Math.sin(cameraElevation);
      const x = cameraRadius * sinElevation * Math.cos(cameraAzimuth);
      const y = cameraRadius * Math.cos(cameraElevation);
      const z = cameraRadius * sinElevation * Math.sin(cameraAzimuth);
      camera.position.set([x, y, z]);
      normalize(camera.forward, -x, -y, -z);
      cross(temporaryA, camera.forward[0], camera.forward[1], camera.forward[2], 0, 1, 0);
      normalize(camera.right, temporaryA[0], temporaryA[1], temporaryA[2]);
      cross(temporaryB, camera.right[0], camera.right[1], camera.right[2], camera.forward[0], camera.forward[1], camera.forward[2]);
      normalize(camera.up, temporaryB[0], temporaryB[1], temporaryB[2]);
    };

    const resize = () => {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sourceCanvas.width = Math.max(1, Math.round(viewportWidth * dpr));
      sourceCanvas.height = Math.max(1, Math.round(viewportHeight * dpr));
      asciiCanvas.width = Math.max(1, Math.round(viewportWidth * dpr));
      asciiCanvas.height = Math.max(1, Math.round(viewportHeight * dpr));
      camera.aspect = viewportWidth / Math.max(viewportHeight, 1);
      columns = Math.max(24, Math.min(160, Math.floor(viewportWidth / 6)));
      rows = Math.max(14, Math.min(90, Math.floor(viewportHeight / 10)));
      cellWidth = viewportWidth / columns;
      cellHeight = viewportHeight / rows;
      const fontSize = Math.max(4, Math.min(28, Math.floor(Math.min(cellHeight / 1.15, cellWidth / 0.6) * 0.72)));
      ascii.setTransform(dpr, 0, 0, dpr, 0, 0);
      ascii.textBaseline = "top";
      ascii.font = `${fontSize}px ${FONT_STACK}`;
      samplerCanvas.width = columns;
      samplerCanvas.height = rows;
      sampler.imageSmoothingEnabled = true;
    };

    const viewProjection = new Float32Array(16);
    const renderWebGL = () => {
      const maxSteps = 2500;
      gl.bindVertexArray(fullscreenVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, internalWidth, internalHeight);
      gl.useProgram(rayProgram);
      gl.uniform2f(rayUniforms.resolution, internalWidth, internalHeight);
      gl.uniform3fv(rayUniforms.camPos, camera.position);
      gl.uniform3fv(rayUniforms.camRight, camera.right);
      gl.uniform3fv(rayUniforms.camUp, camera.up);
      gl.uniform3fv(rayUniforms.camForward, camera.forward);
      gl.uniform1f(rayUniforms.tanHalfFov, camera.tanHalfFov);
      gl.uniform1f(rayUniforms.aspect, camera.aspect);
      gl.uniform1f(rayUniforms.rs, 1.269e10);
      gl.uniform1f(rayUniforms.stepSize, 6e11 / maxSteps);
      gl.uniform1f(rayUniforms.escapeRadius, 1e30);
      gl.uniform1i(rayUniforms.maxSteps, maxSteps);
      gl.uniform1f(rayUniforms.diskR1, 2.7918e10);
      gl.uniform1f(rayUniforms.diskR2, 6.5988e10);
      gl.uniform1i(rayUniforms.numObjects, 2);
      gl.uniform4fv(rayUniforms.objectPositions, objectPositions);
      gl.uniform4fv(rayUniforms.objectColors, objectColors);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, sourceCanvas.width, sourceCanvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const right = camera.right;
      const up = camera.up;
      const forward = camera.forward;
      const position = camera.position;
      const view = new Float32Array([
        right[0], right[1], right[2], 0,
        up[0], up[1], up[2], 0,
        -forward[0], -forward[1], -forward[2], 0,
        -(right[0] * position[0] + right[1] * position[1] + right[2] * position[2]),
        -(up[0] * position[0] + up[1] * position[1] + up[2] * position[2]),
        forward[0] * position[0] + forward[1] * position[1] + forward[2] * position[2], 1,
      ]);
      const scale = 1 / camera.tanHalfFov;
      const range = 1 / (1e9 - 1e14);
      const projection = new Float32Array([
        scale / camera.aspect, 0, 0, 0,
        0, scale, 0, 0,
        0, 0, 1.00001e14 * range, -1,
        0, 0, 2e23 * range, 0,
      ]);
      for (let column = 0; column < 4; column += 1) {
        const a = view[column * 4];
        const b = view[column * 4 + 1];
        const c = view[column * 4 + 2];
        const d = view[column * 4 + 3];
        viewProjection[column * 4] = projection[0] * a + projection[4] * b + projection[8] * c + projection[12] * d;
        viewProjection[column * 4 + 1] = projection[1] * a + projection[5] * b + projection[9] * c + projection[13] * d;
        viewProjection[column * 4 + 2] = projection[2] * a + projection[6] * b + projection[10] * c + projection[14] * d;
        viewProjection[column * 4 + 3] = projection[3] * a + projection[7] * b + projection[11] * c + projection[15] * d;
      }

      gl.useProgram(gridProgram);
      gl.uniformMatrix4fv(gridViewProjection, false, viewProjection);
      gl.bindVertexArray(gridVao);
      gl.drawElements(gl.LINES, gridIndices.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(fullscreenVao);
      gl.useProgram(blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(blitTexture, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    };

    const renderAscii = () => {
      sampler.clearRect(0, 0, columns, rows);
      sampler.drawImage(sourceCanvas, 0, 0, columns, rows);
      const pixels = sampler.getImageData(0, 0, columns, rows).data;
      ascii.clearRect(0, 0, viewportWidth, viewportHeight);
      ascii.fillStyle = "#000";
      ascii.fillRect(0, 0, viewportWidth, viewportHeight);
      const maxGlyph = GLYPHS.length - 1;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const offset = (row * columns + column) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
          const glyphIndex = Math.min(maxGlyph, Math.floor(luminance * maxGlyph));
          const glyph = GLYPHS[glyphIndex] || " ";
          if (glyph === " ") continue;
          const boost = Math.max(0.3, (glyphIndex / maxGlyph) * 1.5 + 0.5);
          const channel = (value) => Math.max(Math.min(Math.round(value * boost), 255), 60);
          ascii.fillStyle = `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, 0.8)`;
          ascii.fillText(glyph, column * cellWidth, row * cellHeight);
        }
      }
    };

    const animate = (time) => {
      animationFrame = requestAnimationFrame(animate);
      if (document.hidden || time - lastFrame < 1000 / 30) return;
      const delta = lastFrame ? (time - lastFrame) / 1000 : 0;
      lastFrame = time;
      if (!reducedMotion.matches) {
        azimuth += 0.325 * delta;
        pointerAzimuth += (targetPointerAzimuth - pointerAzimuth) * 0.045;
        pointerElevation += (targetPointerElevation - pointerElevation) * 0.045;
      }
      updateCamera();
      renderWebGL();
      renderAscii();
    };

    updateCamera();
    resize();
    renderWebGL();
    renderAscii();
    animationFrame = requestAnimationFrame(animate);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", (event) => {
      if (reducedMotion.matches) return;
      targetPointerAzimuth = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 0.24;
      targetPointerElevation = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * -0.12;
    }, { passive: true });

    window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
