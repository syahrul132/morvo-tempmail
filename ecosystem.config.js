module.exports = {
  apps: [{
    name: 'morvo-tempmail',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATA_FILE: '/var/www/morvo-tempmail/data/db.json',
      SESSION_SECRET: 'CHANGE_ME_TO_A_RANDOM_SECRET_ON_NEW_VPS'
    },
    max_memory_restart: '256M',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/morvo/error.log',
    out_file: '/var/log/morvo/out.log',
    merge_logs: true
  }]
};
