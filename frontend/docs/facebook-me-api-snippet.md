# Facebook `FB.api('/me')` integration snippet

Yes — some coding is required in the callback and in the login/permission flow.

## 1) Request a User access token first

```js
FB.login(
  function (loginResponse) {
    if (!loginResponse || !loginResponse.authResponse) {
      console.error('Facebook login was cancelled or failed.');
      return;
    }

    FB.api(
      '/me',
      'GET',
      { fields: 'id,name' },
      function (response) {
        if (!response || response.error) {
          console.error('FB /me error:', response?.error || response);
          return;
        }

        // Insert your code here
        const facebookUser = {
          facebookId: response.id,
          fullName: response.name
        };

        console.log('Facebook user loaded:', facebookUser);
      }
    );
  },
  {
    // Minimal scope for id + name
    scope: 'public_profile'
  }
);
```

## 2) Why your Explorer call failed

If you see `OAuthException` with code `100` and a message similar to
`Object does not exist, cannot be loaded due to missing permissions`,
it usually means one of these:

- You are using a **Page token** instead of a **User token** for `/me`.
- The token is expired/invalid.
- The app/user/token context in Graph API Explorer does not match.
- `public_profile` is missing.

## 3) Production checklist

- Ensure Facebook SDK is initialized with your app ID.
- Ensure user is logged in and granted `public_profile`.
- Handle `response.error` every time.
- Send `response.id` to backend only over HTTPS if you are linking accounts.
