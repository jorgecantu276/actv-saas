const legacyWordPress = URL.parse(process.env.ACTV_LEGACY_WORDPRESS_ORIGIN ?? 'https://actv.mx');

export const wordpressOrigin = legacyWordPress?.protocol === 'https:' && !legacyWordPress.username && !legacyWordPress.password
  ? legacyWordPress.origin : 'https://actv.mx';
