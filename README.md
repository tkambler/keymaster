# Keymaster

![Keymaster](assets/keymaster.jpg)

> "I am the Keymaster! The Destructor is coming. Gozer the Traveler, the Destroyer."

Keymaster is a terminal utility for managing SSH tunnels. It runs in the foreground and presents you with an interface with which you can interactively enable or disable SSH tunnels at will. If and when network errors occur, connections are automatically restored. Connections are managed with the help of the [ssh2](https://www.npmjs.com/package/ssh2) library. As a result, no local ssh or autossh binary is necessary. Keymaster has been confirmed to work on both MacOS and Windows.

Oh yeah, if your user has a `keymaster.js` file in their home directory, Keymaster will also run that before attempting to create tunnels. The ability to hook into the tunnel lifecycle in this way can be particulary helpful in some environments - e.g. if you're required to routinely re-sign a key (stored in [Vault](https://www.vaultproject.io/), perhaps?).

By default, Keymaster reads the SSH config file stored at `~/.ssh/config`:

```
# When this host is selected, port 5000 on the client will be forwarded to port 5000
# on pluto via a direct SSH connection to pluto (192.168.1.10).
Host pluto
    HostName 192.168.1.10
    Port 22
    User ubuntu
    IdentityFile ~/.ssh/id_rsa
    LocalForward 5000 127.0.0.1:5000

# This host will not be presented by the UI, as no LocalForward parameters have been set.
Host mars
    HostName 192.168.1.11
    User admin
    IdentityFile ~/.ssh/flurp

# When this host is selected, port 4000 on the client will be forwarded to port 4000
# on jupiter via an SSH connection that is proxied through mars.
Host jupiter
    HostName 192.168.1.12
    User system
    IdentityFile ~/.ssh/flurp
    ProxyJump mars
    LocalForward 4000 127.0.0.1:4000

# This host will not be presented by the UI, as we've set KeyMasterIgnore to yes.
Host earth
    HostName 192.168.1.14
    User ubuntu
    IdentityFile ~/.ssh/flurp
    KeymasterIgnore yes
    LocalForward 9000 127.0.0.1:80
```

## Show, Don't Tell

![Keymaster](assets/keymaster.gif)

## Get Started

```
npm install -g @tkambler/keymaster
keymaster
```
