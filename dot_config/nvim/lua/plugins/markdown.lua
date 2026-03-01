return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    opts = {
      html = {
        comment = {
          conceal = false,
        },
      },
    },
  },
  {
    "3rd/diagram.nvim",
    dependencies = { "3rd/image.nvim" },
    opts = {
      events = {
        render_buffer = { "InsertLeave", "TextChanged", "BufEnter" },
        clear_buffer = { "BufLeave", "InsertEnter" },
      },
      renderer_options = {
        mermaid = {
          theme = "default",
        },
      },
    },
  },
}
