const PREVIEW_READ_ONLY_MESSAGE = 'This shared demo is read-only so everyone can explore it safely. Create your own account to start a private workspace, add your own data, and make changes.'

export function createPreviewReadOnlyError() {
  return createError({
    statusCode: 403,
    statusMessage: PREVIEW_READ_ONLY_MESSAGE,
    data: {
      code: 'PREVIEW_READ_ONLY',
      message: PREVIEW_READ_ONLY_MESSAGE,
    },
  })
}
