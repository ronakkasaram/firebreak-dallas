# Vendored from the FALCON research code (ST_MotionNet_Training/Toya.py, the ST-MotionNet predictor).
# Only the import line changed, so it loads as part of this package.
import equinox as eqx
import jax.numpy as jnp
import jax
from .convlstm import ConvLSTMCell


class SafePReLU(eqx.Module):
    prelu: eqx.nn.PReLU

    def __init__(self, init_alpha=0.25):
        self.prelu = eqx.nn.PReLU(init_alpha)

    def __call__(self, x, *, key=None):
        return self.prelu(x)


class DropPath(eqx.Module):
    """Stochastic depth / drop path for residual branches.

    During training: randomly drops the entire residual branch with probability `rate`,
    scaling surviving branches by 1/(1-rate) to preserve expected values.
    During inference: identity (no-op).
    """
    rate: float = eqx.field(static=True)

    def __init__(self, rate: float = 0.05):
        self.rate = rate

    def __call__(self, x, *, key=None):
        if key is None:  # inference mode
            return x
        dtype = x.dtype
        keep = jnp.array(1.0, dtype=dtype) - jax.random.bernoulli(key, p=self.rate).astype(dtype)
        return x * keep / jnp.array(1.0 - self.rate, dtype=dtype)


class ImgEncoder(eqx.Module):
    convs: list
    prelus: list
    pools: list

    def __init__(self, in_channels, out_channels, kernel_size, stride, padding, key):
        keys = jax.random.split(key, 12)
        self.convs = [
            eqx.nn.Conv2d(in_channels, out_channels // 8, kernel_size, stride, padding, key=keys[0], use_bias=True),
            eqx.nn.Conv2d(out_channels // 8, out_channels // 8, kernel_size, stride, padding, key=keys[1], use_bias=True),
            eqx.nn.Conv2d(out_channels // 8, out_channels // 4, kernel_size, stride, padding, key=keys[2], use_bias=True),

            eqx.nn.Conv2d(out_channels // 4, out_channels // 4, kernel_size, stride, padding, key=keys[3], use_bias=True),
            eqx.nn.Conv2d(out_channels // 4, out_channels // 4, kernel_size, stride, padding, key=keys[4], use_bias=True),
            eqx.nn.Conv2d(out_channels // 4, out_channels // 2, kernel_size, stride, padding, key=keys[5], use_bias=True),

            eqx.nn.Conv2d(out_channels // 2, out_channels // 2, kernel_size, stride, padding, key=keys[6], use_bias=True),
            eqx.nn.Conv2d(out_channels // 2, out_channels // 2, kernel_size, stride, padding, key=keys[7], use_bias=True),
            eqx.nn.Conv2d(out_channels // 2, out_channels, kernel_size, stride, padding, key=keys[8], use_bias=True),

            eqx.nn.Conv2d(out_channels, out_channels, kernel_size, stride, padding, key=keys[9], use_bias=True),
            eqx.nn.Conv2d(out_channels, out_channels, kernel_size, stride, padding, key=keys[10], use_bias=True),
            eqx.nn.Conv2d(out_channels, out_channels, kernel_size, stride, padding, key=keys[11], use_bias=True),
        ]

        self.prelus = [
            eqx.nn.PReLU() for _ in range(12)
        ]
        self.pools = [
            eqx.nn.AvgPool2d(2, 2) for _ in range(3)
        ]

    def __call__(self, img_c_h_w):
        ftr_c_h_w = self.prelus[0](self.convs[0](img_c_h_w))
        ftr_c_h_w = self.prelus[1](self.convs[1](ftr_c_h_w))
        ftr_c_h_w = self.prelus[2](self.convs[2](ftr_c_h_w))
        skip1 = ftr_c_h_w
        ftr_c_h_w = self.pools[0](ftr_c_h_w)
        ftr_c_h_w = self.prelus[3](self.convs[3](ftr_c_h_w))
        ftr_c_h_w = self.prelus[4](self.convs[4](ftr_c_h_w))
        ftr_c_h_w = self.prelus[5](self.convs[5](ftr_c_h_w))
        skip2 = ftr_c_h_w
        ftr_c_h_w = self.pools[1](ftr_c_h_w)
        ftr_c_h_w = self.prelus[6](self.convs[6](ftr_c_h_w))
        ftr_c_h_w = self.prelus[7](self.convs[7](ftr_c_h_w))
        ftr_c_h_w = self.prelus[8](self.convs[8](ftr_c_h_w))
        skip3 = ftr_c_h_w
        ftr_c_h_w = self.pools[2](ftr_c_h_w)
        ftr_c_h_w = self.prelus[9](self.convs[9](ftr_c_h_w))
        ftr_c_h_w = self.prelus[10](self.convs[10](ftr_c_h_w))
        ftr_c_h_w = self.prelus[11](self.convs[11](ftr_c_h_w))
        return ftr_c_h_w, (skip3, skip2, skip1)


class ImgDecoder(eqx.Module):
    convs: list
    prelus: list
    heatmapConv: eqx.nn.Conv2d
    localizationConv: eqx.nn.Conv2d

    def __init__(self, in_channels, numMaps, kernel_size, stride, padding, key):
        key, *keys = jax.random.split(key, 1 + 12)
        heatmapKey, localizationKey = jax.random.split(key, 2)
        self.convs = [
            eqx.nn.ConvTranspose2d(in_channels, in_channels, kernel_size, stride=stride, padding=padding, key=keys[0], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels, in_channels, kernel_size, stride=stride, padding=padding, key=keys[1], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels, in_channels // 2, kernel_size, stride=stride, padding=padding, key=keys[2], use_bias=True),

            eqx.nn.ConvTranspose2d(in_channels // 2 + in_channels, in_channels // 2, kernel_size, stride=stride, padding=padding, key=keys[3], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels // 2, in_channels // 2, kernel_size, stride=stride, padding=padding, key=keys[4], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels // 2, in_channels // 4, kernel_size, stride=stride, padding=padding, key=keys[5], use_bias=True),

            eqx.nn.ConvTranspose2d(in_channels // 4 + in_channels // 2, in_channels // 4, kernel_size, stride=stride, padding=padding, key=keys[6], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels // 4, in_channels // 4, kernel_size, stride=stride, padding=padding, key=keys[7], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels // 4, in_channels // 8, kernel_size, stride=stride, padding=padding, key=keys[8], use_bias=True),

            eqx.nn.ConvTranspose2d(in_channels // 4 + in_channels // 8, in_channels // 8, kernel_size, stride=stride, padding=padding, key=keys[9], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels // 8, in_channels // 8, kernel_size, stride=stride, padding=padding, key=keys[10], use_bias=True),
            eqx.nn.ConvTranspose2d(in_channels // 8, in_channels // 8, kernel_size, stride=stride, padding=padding, key=keys[11], use_bias=True),
        ]

        self.prelus = [
            eqx.nn.PReLU() for _ in range(12)
        ]

        self.heatmapConv = eqx.nn.Conv2d(in_channels // 8, numMaps, kernel_size, stride, padding, key=heatmapKey, use_bias=True)
        self.localizationConv = eqx.nn.Conv2d(in_channels // 8, numMaps, kernel_size, stride, padding, key=localizationKey, use_bias=True)

    def __call__(self, img_c_h_w, skips):
        C, H, W = img_c_h_w.shape
        ftr_c_h_w = self.prelus[0](self.convs[0](img_c_h_w))
        ftr_c_h_w = self.prelus[1](self.convs[1](ftr_c_h_w))
        ftr_c_h_w = self.prelus[2](self.convs[2](ftr_c_h_w))
        ftr_c_h_w = jax.image.resize(ftr_c_h_w, (C // 2, H * 2, W * 2), method="bilinear")
        ftr_c_h_w = self.prelus[3](self.convs[3](jnp.concatenate([ftr_c_h_w, skips[0]], axis=0)))
        ftr_c_h_w = self.prelus[4](self.convs[4](ftr_c_h_w))
        ftr_c_h_w = self.prelus[5](self.convs[5](ftr_c_h_w))
        ftr_c_h_w = jax.image.resize(ftr_c_h_w, (C // 4, H * 4, W * 4), method="bilinear")
        ftr_c_h_w = self.prelus[6](self.convs[6](jnp.concatenate([ftr_c_h_w, skips[1]], axis=0)))
        ftr_c_h_w = self.prelus[7](self.convs[7](ftr_c_h_w))
        ftr_c_h_w = self.prelus[8](self.convs[8](ftr_c_h_w))
        ftr_c_h_w = jax.image.resize(ftr_c_h_w, (C // 8, H * 8, W * 8), method="bilinear")
        ftr_c_h_w = self.prelus[9](self.convs[9](jnp.concatenate([ftr_c_h_w, skips[2]], axis=0)))
        ftr_c_h_w = self.prelus[10](self.convs[10](ftr_c_h_w))
        ftr_c_h_w = self.prelus[11](self.convs[11](ftr_c_h_w))

        heatmap_c_h_w = self.heatmapConv(ftr_c_h_w)
        localization_c_h_w = self.localizationConv(ftr_c_h_w)

        return heatmap_c_h_w, localization_c_h_w


class ConvSA(eqx.Module):
    QKV_c_h_w: eqx.nn.Conv2d
    output_c_h_w: eqx.nn.Conv2d
    lNorm_c_h_w: eqx.nn.LayerNorm
    gamma_c_h_w: jax.Array

    def __init__(self, in_channels, out_channels, kernel_size, stride, padding, key):
        init_weight_key, *keys = jax.random.split(key, 1 + 2)
        self.QKV_c_h_w = eqx.nn.Conv2d(
            in_channels=in_channels,
            out_channels=in_channels*3,
            kernel_size=kernel_size,
            stride=stride,
            padding=padding,
            key=keys[0]
        )
        self.output_c_h_w = eqx.nn.Conv2d(
            in_channels=in_channels,
            out_channels=out_channels,
            kernel_size=(1, 1),
            stride=1,
            key=keys[1]
        )
        self.lNorm_c_h_w = eqx.nn.LayerNorm((in_channels, 32, 32))
        self.gamma_c_h_w = jnp.zeros((out_channels, 1, 1))
        self._init_weights(init_weight_key)

    def _init_weights(self, key):
        _, *weight_initializer_key = jax.random.split(
            key,
            1 + 3
        )
        where = lambda l: l.weight
        new_weights = jax.nn.initializers.he_normal()(
            weight_initializer_key[0],
            self.QKV_c_h_w.weight.shape,
            dtype=self.QKV_c_h_w.weight.dtype
        )
        self.QKV_c_h_w = eqx.tree_at(where, self.QKV_c_h_w, new_weights)

        new_weights = jax.nn.initializers.he_normal()(
            weight_initializer_key[1],
            self.output_c_h_w.weight.shape,
            dtype=self.output_c_h_w.weight.dtype
        )
        self.output_c_h_w = eqx.tree_at(where, self.output_c_h_w, new_weights)

    def __call__(self, x_c_h_w):
        xln_c_h_w = self.lNorm_c_h_w(x_c_h_w)
        q_c_h_w, k_c_h_w, v_c_h_w = jnp.split(self.QKV_c_h_w(xln_c_h_w), 3, axis=0)
        c, h, w = q_c_h_w.shape
        q_hw_1_c, k_hw_1_c, v_hw_1_c = (
            q_c_h_w.reshape((c, -1)).transpose((1, 0))[:, jnp.newaxis, :],
            k_c_h_w.reshape((c, -1)).transpose((1, 0))[:, jnp.newaxis, :],
            v_c_h_w.reshape((c, -1)).transpose((1, 0))[:, jnp.newaxis, :],
        )
        # The supplied implementation forced cuDNN, preventing a CPU smoke
        # test. Keep the original NVIDIA path and use XLA on CPU.
        on_gpu = jax.default_backend() == "gpu"
        attention_dtype = jnp.bfloat16 if on_gpu else x_c_h_w.dtype
        vPrime_hw_1_c = jax.nn.dot_product_attention(
            q_hw_1_c.astype(attention_dtype),
            k_hw_1_c.astype(attention_dtype),
            v_hw_1_c.astype(attention_dtype),
            implementation="cudnn" if on_gpu else "xla",
        )
        vPrime_c_h_w = vPrime_hw_1_c.astype(x_c_h_w.dtype).squeeze(axis=1).transpose((1, 0)).reshape((-1, h, w))
        output_c_h_w = self.gamma_c_h_w * self.output_c_h_w(vPrime_c_h_w)
        return output_c_h_w


class LatentProcessor(eqx.Module):
    layers: list
    normals: list
    norms: list
    sas: list
    groupNorms: list
    drop_paths: list
    finalNorm: eqx.nn.LayerNorm
    numLayers: int = eqx.field(static=True)

    def __init__(self, in_channels, out_channels, kernel_size, stride, padding,
                 numLayers=4, numHeads=8, drop_path_rate=0.05, key=jax.random.PRNGKey(0)):
        self.numLayers = numLayers
        keys = jax.random.split(key, numLayers + 1)
        key, *keys2 = jax.random.split(keys[-1], 1 + numLayers)
        key, *keys3 = jax.random.split(key, 1 + numLayers)

        self.norms = [
            eqx.nn.LayerNorm((in_channels, 32, 32)) for _ in range(numLayers)
        ]

        self.layers = [
            ConvLSTMCell(in_channels, out_channels, kernel_size, stride, padding, recurrent_groups=numHeads, key=keys[i])
            for i in range(numLayers)
        ]
        self.normals = [
            eqx.nn.Conv2d(in_channels, out_channels, kernel_size=kernel_size, stride=stride, padding=padding,
                          key=keys2[i], use_bias=True)
            for i in range(numLayers)
        ]
        self.sas = [
            ConvSA(out_channels, out_channels, kernel_size, stride, padding, key=keys3[i]) for i in range(numLayers)
        ]
        self.finalNorm = eqx.nn.LayerNorm((out_channels, 32, 32))
        self.groupNorms = [eqx.nn.GroupNorm(numHeads, out_channels) for _ in range(numLayers)]
        # Two drop paths per layer: one for recurrent residual, one for FFN residual
        self.drop_paths = [DropPath(drop_path_rate) for _ in range(numLayers)]

    def getInitState(self):
        return tuple([self.layers[i].getInitState() for i in range(self.numLayers)])

    def __call__(self, input_c_h_w, states, *, key=None):
        next_states = []
        current_c_h_w = input_c_h_w

        # Split keys for each drop path if training
        if key is not None:
            dp_keys = jax.random.split(key, self.numLayers)
        else:
            dp_keys = [None] * self.numLayers

        for i, (norm, cell, groupNorm, sa, conv, drop, state_tuple) in enumerate(
                zip(self.norms, self.layers, self.groupNorms, self.sas, self.normals, self.drop_paths, states)
        ):
            currentLn_c_h_w = norm(current_c_h_w)
            cell_out_c_h_w, new_state_tuple = cell(currentLn_c_h_w, state_tuple)
            preSA_c_h_w = groupNorm(cell_out_c_h_w) + current_c_h_w
            postSA_c_h_w = drop(sa(preSA_c_h_w), key=dp_keys[i]) + preSA_c_h_w
            current_c_h_w = conv(postSA_c_h_w)
            next_states.append(new_state_tuple)
        current_c_h_w = self.finalNorm(current_c_h_w)
        return current_c_h_w, tuple(next_states)


def add_coord_channels(x_t_c_h_w):
    t, c, h, w = x_t_c_h_w.shape
    dtype = x_t_c_h_w.dtype

    # 1. Create ranges once
    x_range = jnp.linspace(-1, 1, w, dtype=dtype)
    y_range = jnp.linspace(-1, 1, h, dtype=dtype)
    x_grid, y_grid = jnp.meshgrid(x_range, y_range)

    # 2. Reshape to (1, 1, H, W) for broadcasting
    x_grid = x_grid[None, None, :, :]
    y_grid = y_grid[None, None, :, :]

    # 3. Broadcast to match Time dimension T
    x_grid = jnp.broadcast_to(x_grid, (t, 1, h, w))
    y_grid = jnp.broadcast_to(y_grid, (t, 1, h, w))

    # 4. Final 6-channel + 2-channel = 8-channel output
    return jnp.concatenate([x_t_c_h_w, x_grid, y_grid], axis=1)


class Toya(eqx.Module):
    encoder: ImgEncoder
    latentProcessor: LatentProcessor
    decoder: ImgDecoder
    bounded_signal: bool = eqx.field(static=True)

    def __init__(self, in_channels, out_channels, numMaps, kernel_size, stride, padding, numLayers, numHeads, dropPathRate, key, bounded_signal=False):
        self.bounded_signal = bounded_signal
        encoderKey, latentPKey, latentAKey, decoderKey = jax.random.split(key, 4)

        self.encoder = ImgEncoder(in_channels + 2, out_channels, kernel_size, stride, padding, key=encoderKey)
        self.latentProcessor = LatentProcessor(out_channels, out_channels, kernel_size, stride, padding, numLayers, numHeads, dropPathRate, key=latentPKey)
        self.decoder = ImgDecoder(out_channels, numMaps, kernel_size, stride, padding, key=decoderKey)

    def getInitState(self):
        return self.latentProcessor.getInitState()

    def __call__(self, img_t_c_h_w, state, *, key=None):
        img_t_c_h_w = add_coord_channels(img_t_c_h_w)
        imgFtr_t_c_h_w, skips_t_c_h_w = jax.vmap(self.encoder)(img_t_c_h_w)

        def fn(carry, ftr_c_h_w):
            carryState, k = carry
            if k is not None:
                k, stepKey = jax.random.split(k, 2)
            else:
                k = None
            newFtr_c_h_w, newCarryState = self.latentProcessor(ftr_c_h_w, carryState, key=stepKey if k is not None else None)
            return (newCarryState, k), newFtr_c_h_w

        (newState, _), latentFtr_t_c_h_w = jax.lax.scan(fn, (state, key), imgFtr_t_c_h_w)
        heatmap_t_c_h_w, beliefMap_t_c_h_w = jax.vmap(self.decoder)(latentFtr_t_c_h_w, skips_t_c_h_w)
        if self.bounded_signal:
            heatmap_t_c_h_w = 0.01 + 0.99 * jax.nn.sigmoid(heatmap_t_c_h_w)
        return (heatmap_t_c_h_w, beliefMap_t_c_h_w), newState


# if __name__ == '__main__':
    # data = jax.random.uniform(jax.random.PRNGKey(23), (95, 4, 256, 256))
    #
    # m = Toya(4, 64, 5, 3, 1, 1, 4, 8, 0.15, jax.random.PRNGKey(12))
    # latentPrevStates = m.latentProcessor.getInitState()
    # h, l = m(data, latentPrevStates)
    # print(h.shape)
