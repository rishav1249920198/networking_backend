const crypto = require('crypto');

/**
 * Parses Cloudinary URL for publicId, version, and type
 */
const getPublicIdFromUrl = (url) => {
  if (!url) return {};
  try {
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return {};

    // Get segments after /upload/
    const afterUpload = parts.slice(uploadIndex + 1);
    
    // Find version segment (vNNN)
    const versionSegment = afterUpload.find(p => p.startsWith('v') && /^\d+$/.test(p.substring(1)));
    const version = versionSegment ? versionSegment.substring(1) : null;
    
    // publicId with potential folders
    const vIdx = versionSegment ? afterUpload.indexOf(versionSegment) : -1;
    const publicIdSegments = (vIdx !== -1) 
      ? afterUpload.slice(vIdx + 1)
      : afterUpload.filter(p => !p.startsWith('s--')); // skip signature if present

    const publicId = publicIdSegments.join('/');
    const resourceType = url.includes('/raw/') ? 'raw' : 'image';

    return { id: publicId, version, resourceType };
  } catch (e) {
    console.error('Error parsing Cloudinary URL:', e);
    return {};
  }
};

/**
 * Manually signs a private URL for backend proxy
 */
const signUrlManually = (publicId, { resourceType = 'image', version, secret }) => {
  const v = version ? `v${version}/` : "";
  const stringToSign = `${v}${publicId}`;
  return crypto.createHash('sha1').update(stringToSign + secret).digest('hex');
};

/**
 * Returns the alternate resource type for retry logic
 */
const getAlternateResourceType = (current) => (current === 'raw' ? 'image' : 'raw');

module.exports = { getPublicIdFromUrl, signUrlManually, getAlternateResourceType };
