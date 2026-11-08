# Vendored from the FALCON research code (ST_MotionNet_Training/ConvLSTM.py, stationary-sensor checkout).
# Unchanged except for this header.
import jax
import jax.numpy as jnp
import equinox as eqx


class ConvLSTMCell(eqx.Module):
    Wx_conv: eqx.nn.Conv2d
    Rh_conv: eqx.nn.Conv2d
    bias: jnp.ndarray

    inputSize: int = eqx.field(static=True)
    hiddenSize: int = eqx.field(static=True)
    row: int = eqx.field(static=True)
    col: int = eqx.field(static=True)
    forgetBias: float = eqx.field(static=True)

    def __init__(
        self,
        in_channels: int,
        hidden_size: int,
        kernel_size,
        stride: int = 1,
        padding: int = 1,
        row: int = 32,
        col: int = 32,
        use_bias: bool = True,
        forget_bias: float = 1.0,
        recurrent_groups: int = 1,
        key=jax.random.PRNGKey(0),
    ):
        """
        Standard ConvLSTM cell.

        Input shape:
            x:     (in_channels, row, col)
            h, c:  (hidden_size, row, col)

        Output:
            h_new, (h_new, c_new)

        Gate order:
            input gate, forget gate, candidate gate, output gate
        """

        assert hidden_size % recurrent_groups == 0, (
            "hidden_size must be divisible by recurrent_groups"
        )

        keys = jax.random.split(key, 2)

        self.Wx_conv = eqx.nn.Conv2d(
            in_channels=in_channels,
            out_channels=4 * hidden_size,
            kernel_size=kernel_size,
            stride=stride,
            padding=padding,
            use_bias=False,
            key=keys[0],
        )

        self.Rh_conv = eqx.nn.Conv2d(
            in_channels=hidden_size,
            out_channels=4 * hidden_size,
            kernel_size=kernel_size,
            stride=stride,
            padding=padding,
            groups=recurrent_groups,
            use_bias=False,
            key=keys[1],
        )

        if use_bias:
            self.bias = jnp.zeros((4 * hidden_size, 1, 1))
        else:
            self.bias = jnp.zeros((4 * hidden_size, 1, 1))

        self.inputSize = in_channels
        self.hiddenSize = hidden_size
        self.row = row
        self.col = col
        self.forgetBias = forget_bias

    def getInitState(self):
        return (
            jnp.zeros((self.hiddenSize, self.row, self.col)),  # h
            jnp.zeros((self.hiddenSize, self.row, self.col)),  # c
        )

    def __call__(self, inputs, state):
        h, c = state

        gates = self.Wx_conv(inputs) + self.Rh_conv(h) + self.bias

        i_raw, f_raw, g_raw, o_raw = jnp.split(gates, 4, axis=0)

        i = jax.nn.sigmoid(i_raw)
        f = jax.nn.sigmoid(f_raw + self.forgetBias)
        g = jnp.tanh(g_raw)
        o = jax.nn.sigmoid(o_raw)

        c_new = f * c + i * g
        h_new = o * jnp.tanh(c_new)

        return h_new, (h_new, c_new)