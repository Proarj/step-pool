// Removes the Push Notifications entitlement from an .entitlements plist.
// Free Apple developer accounts cannot sign apps that carry it.
function stripPushEntitlement(xml) {
  return xml.replace(/\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/g, '');
}

module.exports = { stripPushEntitlement };
