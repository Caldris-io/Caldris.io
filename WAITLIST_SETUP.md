# Waitlist Email Storage Setup ✅

## Current Setup: Web3Forms (Reliable & Free)

Your email form is now configured to send submissions to **chris@caldris.io** using Web3Forms.

### How it works:
1. When someone submits the form, you'll receive an email at **chris@caldris.io**
2. No confirmation needed - emails start arriving immediately
3. All submissions come directly to your inbox as nicely formatted emails

### What's included in each email:
- Email address submitted
- Source (hero form or CTA form)
- Timestamp

### To change the destination email:
1. Go to https://web3forms.com and get a new access key with your email
2. Update the `web3formsKey` in `src/waitlist-form.js` (line 14)

## Benefits of this setup:
- ✅ **No confirmation needed** - works immediately
- ✅ **Completely free** - 250 submissions/month
- ✅ **No database needed** - emails go straight to your inbox
- ✅ **PostHog tracking** - still captures analytics
- ✅ **Better deliverability** - more reliable than Formsubmit
- ✅ **Spam protection** - built-in hCaptcha integration available

## Alternative: Google Sheets Integration

If you want submissions in a Google Sheet instead:

1. Go to [formspree.io](https://formspree.io) (free account)
2. Create a form and connect it to Google Sheets
3. Replace line 626-640 in `index.html` with:
```javascript
const response = await fetch('https://formspree.io/f/YOUR_FORM_ID', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        email: email,
        source: formId === 'waitlist-hero' ? 'hero' : 'cta',
        timestamp: new Date().toISOString()
    })
});
```

## Testing:
1. Deploy your site
2. Submit a test email
3. Check your inbox at chris@caldris.io - email should arrive within 1-2 minutes
4. All future submissions will arrive automatically!
