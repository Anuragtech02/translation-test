#!/bin/bash
# Setup script for the translation viewer

# Color codes for prettier output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  Setting up Translation Viewer                  ${NC}"
echo -e "${GREEN}=================================================${NC}"

# Create necessary directories
echo -e "\n${YELLOW}Creating necessary directories...${NC}"
mkdir -p translation-viewer/views
mkdir -p translation-viewer/public
mkdir -p translation-viewer/routes

# Check if views files exist, if not create them
if [ ! -f "translation-viewer/views/index.ejs" ]; then
  echo -e "${YELLOW}Creating index.ejs view...${NC}"
  cat > translation-viewer/views/index.ejs << 'EOL'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Translation Viewer</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    .card-hover:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 20px rgba(0,0,0,.12);
      transition: all 0.3s ease;
    }
    .card {
      transition: all 0.3s ease;
    }
    .stats-card {
      border-left: 4px solid #0d6efd;
    }
  </style>
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
    <div class="container">
      <a class="navbar-brand" href="/">Translation Viewer</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav">
          <li class="nav-item">
            <a class="nav-link active" href="/">Home</a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="/upload-status">Upload Status</a>
          </li>
        </ul>
      </div>
    </div>
  </nav>

  <div class="container mt-4">
    <h1 class="mb-4">Translation Dashboard</h1>

    <div class="row mb-4" id="statsRow" style="display: none;">
      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Translation Statistics</h5>
            <div class="row" id="statsCards">
              <div class="col-md-3 mb-3">
                <div class="card stats-card h-100">
                  <div class="card-body">
                    <h5 class="card-title text-primary">Content Types</h5>
                    <h2 id="contentTypeCount">-</h2>
                  </div>
                </div>
              </div>
              <div class="col-md-3 mb-3">
                <div class="card stats-card h-100">
                  <div class="card-body">
                    <h5 class="card-title text-primary">Items</h5>
                    <h2 id="itemCount">-</h2>
                  </div>
                </div>
              </div>
              <div class="col-md-3 mb-3">
                <div class="card stats-card h-100">
                  <div class="card-body">
                    <h5 class="card-title text-primary">Translations</h5>
                    <h2 id="translationCount">-</h2>
                  </div>
                </div>
              </div>
              <div class="col-md-3 mb-3">
                <div class="card stats-card h-100">
                  <div class="card-body">
                    <h5 class="card-title text-primary">Languages</h5>
                    <h2 id="languageCount">-</h2>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Content Types</h5>
            <div class="row" id="contentTypes">
              <div class="col-12 text-center">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      // Fetch content types
      fetch('/api/content-types')
        .then(response => response.json())
        .then(data => {
          const contentTypesContainer = document.getElementById('contentTypes');
          contentTypesContainer.innerHTML = '';

          if (data.contentTypes.length === 0) {
            contentTypesContainer.innerHTML = '<div class="col-12"><p class="text-center">No content types found</p></div>';
            return;
          }

          data.contentTypes.forEach(contentType => {
            const col = document.createElement('div');
            col.className = 'col-md-4 mb-4';

            col.innerHTML = `
              <div class="card h-100 card-hover">
                <div class="card-body">
                  <h5 class="card-title">${contentType}</h5>
                  <p class="card-text">Content type: ${contentType}</p>
                  <a href="/content/${contentType}" class="btn btn-primary">View Items</a>
                </div>
              </div>
            `;

            contentTypesContainer.appendChild(col);
          });
        })
        .catch(error => {
          console.error('Error fetching content types:', error);
          document.getElementById('contentTypes').innerHTML = '<div class="col-12"><p class="text-center text-danger">Error loading content types</p></div>';
        });

      // Stats functionality
      const statsLink = document.getElementById('statsLink');
      const statsRow = document.getElementById('statsRow');

      if (statsLink && statsRow) {
        statsLink.addEventListener('click', function(e) {
          e.preventDefault();

          if (statsRow.style.display === 'none') {
            statsRow.style.display = 'flex';

            // Fetch stats data
            fetch('/api/stats')
              .then(response => response.json())
              .then(data => {
                document.getElementById('contentTypeCount').textContent = data.stats.contentTypes;
                document.getElementById('itemCount').textContent = data.stats.items;
                document.getElementById('translationCount').textContent = data.stats.translations;
                document.getElementById('languageCount').textContent = data.stats.languages.length;
              })
              .catch(error => {
                console.error('Error fetching stats:', error);
              });
          } else {
            statsRow.style.display = 'none';
          }
        });
      }
    });
  </script>
</body>
</html>
EOL
fi

if [ ! -f "translation-viewer/views/content-type.ejs" ]; then
  echo -e "${YELLOW}Creating content-type.ejs view...${NC}"
  cat > translation-viewer/views/content-type.ejs << 'EOL'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= contentType %> - Translation Viewer</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    .card-hover:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 20px rgba(0,0,0,.12);
      transition: all 0.3s ease;
    }
    .card {
      transition: all 0.3s ease;
    }
  </style>
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
    <div class="container">
      <a class="navbar-brand" href="/">Translation Viewer</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav">
          <li class="nav-item">
            <a class="nav-link" href="/">Home</a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="/upload-status">Upload Status</a>
          </li>
        </ul>
      </div>
    </div>
  </nav>

  <div class="container mt-4">
    <nav aria-label="breadcrumb">
      <ol class="breadcrumb">
        <li class="breadcrumb-item"><a href="/">Home</a></li>
        <li class="breadcrumb-item active" aria-current="page"><%= contentType %></li>
      </ol>
    </nav>

    <h1 class="mb-4"><%= contentType %> Items</h1>

    <div class="row">
      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Available Items</h5>
            <div class="row" id="items">
              <div class="col-12 text-center">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      const contentType = '<%= contentType %>';

      // Fetch items for this content type
      fetch(`/api/content/${contentType}`)
        .then(response => response.json())
        .then(data => {
          const itemsContainer = document.getElementById('items');
          itemsContainer.innerHTML = '';

          if (!data.items || data.items.length === 0) {
            itemsContainer.innerHTML = '<div class="col-12"><p class="text-center">No items found</p></div>';
            return;
          }

          data.items.forEach(item => {
            const col = document.createElement('div');
            col.className = 'col-md-4 mb-4';

            col.innerHTML = `
              <div class="card h-100 card-hover">
                <div class="card-body">
                  <h5 class="card-title">${item}</h5>
                  <p class="card-text">Item slug: ${item}</p>
                  <a href="/content/${contentType}/${item}" class="btn btn-primary">View Translations</a>
                </div>
              </div>
            `;

            itemsContainer.appendChild(col);
          });
        })
        .catch(error => {
          console.error(`Error fetching items for ${contentType}:`, error);
          document.getElementById('items').innerHTML = '<div class="col-12"><p class="text-center text-danger">Error loading items</p></div>';
        });
    });
  </script>
</body>
</html>
EOL
fi

# Create upload-status.ejs view
if [ ! -f "translation-viewer/views/upload-status.ejs" ]; then
  echo -e "${YELLOW}Creating upload-status.ejs view...${NC}"
  cat > translation-viewer/views/upload-status.ejs << 'EOL'
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upload Status - Translation Viewer</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
      .status-badge {
        font-size: 0.8rem;
        border-radius: 30px;
        padding: 5px 15px;
      }
      .status-completed {
        background-color: #28a745;
        color: white;
      }
      .status-failed {
        background-color: #dc3545;
        color: white;
      }
      .status-uploading {
        background-color: #007bff;
        color: white;
        animation: pulse 1.5s infinite;
      }
      .status-pending {
        background-color: #6c757d;
        color: white;
      }
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.6; }
        100% { opacity: 1; }
      }
      .progress-card {
        border-left: 4px solid #0d6efd;
        transition: all 0.3s ease;
      }
      .progress-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 20px rgba(0,0,0,.12);
      }
      .refresh-btn {
        cursor: pointer;
      }
      .file-item:hover {
        background-color: #f8f9fa;
      }
      .error-message {
        font-size: 0.85rem;
        padding: 10px;
        background-color: #f8d7da;
        border-radius: 4px;
        margin-top: 5px;
      }
    </style>
  </head>
  <body>
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
      <div class="container">
        <a class="navbar-brand" href="/">Translation Viewer</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarNav">
          <ul class="navbar-nav">
            <li class="nav-item">
              <a class="nav-link" href="/">Home</a>
            </li>
            <li class="nav-item">
              <a class="nav-link active" href="/upload-status">Upload Status</a>
            </li>
          </ul>
        </div>
      </div>
    </nav>

    <div class="container mt-4">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h1>Upload Status Dashboard</h1>
        <div>
          <span class="text-muted me-2 fs-6">Auto-refresh: <span id="countdown">30</span>s</span>
          <button id="refreshButton" class="btn btn-outline-primary">
            Refresh Now
          </button>
        </div>
      </div>

      <div class="row mb-4" id="statsRow">
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-body">
              <div class="d-flex justify-content-between">
                <h5 class="card-title">Upload Progress</h5>
                <span class="text-muted small" id="lastUpdated">Last updated: Never</span>
              </div>
              <div class="row" id="statsCards">
                <div class="col-md-3 mb-3">
                  <div class="card progress-card h-100">
                    <div class="card-body">
                      <h5 class="card-title text-primary">Total Files</h5>
                      <h2 id="totalCount">-</h2>
                    </div>
                  </div>
                </div>
                <div class="col-md-3 mb-3">
                  <div class="card progress-card h-100">
                    <div class="card-body">
                      <h5 class="card-title text-primary">Pending</h5>
                      <h2 id="pendingCount">-</h2>
                    </div>
                  </div>
                </div>
                <div class="col-md-3 mb-3">
                  <div class="card progress-card h-100">
                    <div class="card-body">
                      <h5 class="card-title text-primary">Completed</h5>
                      <h2 id="completedCount">-</h2>
                    </div>
                  </div>
                </div>
                <div class="col-md-3 mb-3">
                  <div class="card progress-card h-100">
                    <div class="card-body">
                      <h5 class="card-title text-primary">Failed</h5>
                      <h2 id="failedCount">-</h2>
                    </div>
                  </div>
                </div>
              </div>

              <div class="row mt-3">
                <div class="col-md-9">
                  <div class="progress" style="height: 30px;">
                    <div id="completedProgress" class="progress-bar bg-success" role="progressbar" style="width: 0%">0%</div>
                    <div id="uploadingProgress" class="progress-bar bg-primary progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%">0%</div>
                    <div id="pendingProgress" class="progress-bar bg-secondary" role="progressbar" style="width: 0%">0%</div>
                    <div id="failedProgress" class="progress-bar bg-danger" role="progressbar" style="width: 0%">0%</div>
                  </div>
                </div>
                <div class="col-md-3">
                  <div id="currentUploadContainer" class="d-none">
                    <span class="text-muted">Currently uploading:</span>
                    <div id="currentUpload" class="text-truncate"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="row mb-4">
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-body">
              <h5 class="card-title">Upload History</h5>
              <div class="table-responsive">
                <table class="table table-hover">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody id="uploadHistoryTable">
                    <tr>
                      <td colspan="4" class="text-center">Loading upload history...</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="d-flex justify-content-between align-items-center mt-3">
                <button id="showMoreBtn" class="btn btn-outline-secondary d-none">Show More</button>
                <span id="historyCount" class="text-muted">Showing 0 of 0 files</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        // Initial variables
        let uploadStatus = {};
        let displayLimit = 10;
        let countdownValue = 30;
        let countdownInterval;

        // DOM elements
        const refreshButton = document.getElementById('refreshButton');
        const uploadHistoryTable = document.getElementById('uploadHistoryTable');
        const showMoreBtn = document.getElementById('showMoreBtn');
        const historyCount = document.getElementById('historyCount');
        const countdownElem = document.getElementById('countdown');

        // Initial load
        fetchUploadStatus();
        startCountdown();

        // Event listeners
        refreshButton.addEventListener('click', function() {
          fetchUploadStatus();
          resetCountdown();
        });

        showMoreBtn.addEventListener('click', function() {
          displayLimit += 10;
          renderUploadHistory();
        });

        // Functions
        function startCountdown() {
          clearInterval(countdownInterval);
          countdownValue = 30;
          countdownElem.textContent = countdownValue;

          countdownInterval = setInterval(() => {
            countdownValue--;
            countdownElem.textContent = countdownValue;

            if (countdownValue <= 0) {
              fetchUploadStatus();
              resetCountdown();
            }
          }, 1000);
        }

        function resetCountdown() {
          clearInterval(countdownInterval);
          startCountdown();
        }

        function fetchUploadStatus() {
          fetch('/api/upload-status')
            .then(response => response.json())
            .then(data => {
              uploadStatus = data.status;
              updateStats();
              renderUploadHistory();
            })
            .catch(error => {
              console.error('Error fetching upload status:', error);
            });

          fetch('/api/upload-status/stats')
            .then(response => response.json())
            .then(data => {
              updateProgressBars(data.stats);
            })
            .catch(error => {
              console.error('Error fetching upload stats:', error);
            });
        }

        function updateStats() {
          if (uploadStatus.lastUpdated) {
            const lastUpdatedDate = new Date(uploadStatus.lastUpdated);
            document.getElementById('lastUpdated').textContent = 'Last updated: ' + formatDateTime(lastUpdatedDate);
          }

          if (uploadStatus.currentlyUploading) {
            document.getElementById('currentUploadContainer').classList.remove('d-none');
            document.getElementById('currentUpload').textContent = uploadStatus.currentlyUploading;
          } else {
            document.getElementById('currentUploadContainer').classList.add('d-none');
          }
        }

        function updateProgressBars(stats) {
          // Update count displays
          document.getElementById('totalCount').textContent = stats.total || 0;
          document.getElementById('pendingCount').textContent = stats.pending || 0;
          document.getElementById('completedCount').textContent = stats.completed || 0;
          document.getElementById('failedCount').textContent = stats.failed || 0;

          // Update progress bars
          const total = stats.total || 0;

          if (total > 0) {
            const completedPct = Math.round((stats.completed || 0) / total * 100);
            const uploadingPct = Math.round((stats.uploading || 0) / total * 100);
            const pendingPct = Math.round((stats.pending || 0) / total * 100);
            const failedPct = Math.round((stats.failed || 0) / total * 100);

            const completedBar = document.getElementById('completedProgress');
            const uploadingBar = document.getElementById('uploadingProgress');
            const pendingBar = document.getElementById('pendingProgress');
            const failedBar = document.getElementById('failedProgress');

            completedBar.style.width = completedPct + '%';
            completedBar.textContent = completedPct + '%';

            uploadingBar.style.width = uploadingPct + '%';
            uploadingBar.textContent = uploadingPct + '%';

            pendingBar.style.width = pendingPct + '%';
            pendingBar.textContent = pendingPct + '%';

            failedBar.style.width = failedPct + '%';
            failedBar.textContent = failedPct + '%';

            // Hide bars with 0%
            completedBar.classList.toggle('d-none', completedPct === 0);
            uploadingBar.classList.toggle('d-none', uploadingPct === 0);
            pendingBar.classList.toggle('d-none', pendingPct === 0);
            failedBar.classList.toggle('d-none', failedPct === 0);
          } else {
            // No data yet
            document.getElementById('completedProgress').style.width = '0%';
            document.getElementById('uploadingProgress').style.width = '0%';
            document.getElementById('pendingProgress').style.width = '0%';
            document.getElementById('failedProgress').style.width = '0%';
          }
        }

        function renderUploadHistory() {
          if (!uploadStatus.files || Object.keys(uploadStatus.files).length === 0) {
            uploadHistoryTable.innerHTML = '<tr><td colspan="4" class="text-center">No upload history available</td></tr>';
            historyCount.textContent = 'Showing 0 of 0 files';
            showMoreBtn.classList.add('d-none');
            return;
          }

          const filesArray = Object.entries(uploadStatus.files).map(([path, data]) => {
            return { path, ...data };
          });

          // Sort by latest first (started or completed)
          filesArray.sort((a, b) => {
            const aTime = a.completedAt || a.startedAt || '';
            const bTime = b.completedAt || b.startedAt || '';
            return bTime.localeCompare(aTime);
          });

          const totalFiles = filesArray.length;
          const filesToShow = filesArray.slice(0, displayLimit);

          uploadHistoryTable.innerHTML = '';

          filesToShow.forEach(file => {
            const row = document.createElement('tr');
            row.className = 'file-item';

            // Extract content type and slug from path
            let contentType = 'Unknown';
            let itemSlug = 'Unknown';

            const pathParts = file.path.split('/');
            if (pathParts.length >= 3) {
              contentType = pathParts[1];
              itemSlug = pathParts[2];
            }

            // Create file cell with path info
            const fileCell = document.createElement('td');
            fileCell.innerHTML = `
              <div>${file.path}</div>
              <small class="text-muted">Content Type: ${contentType}, Item: ${itemSlug}</small>
            `;

            // Create status cell with badge
            const statusCell = document.createElement('td');
            const status = file.status || 'pending';
            statusCell.innerHTML = `<span class="badge status-badge status-${status}">${status}</span>`;

            if (file.error) {
              statusCell.innerHTML += `
                <div class="error-message">
                  <small>${file.error}</small>
                </div>
              `;
            }

            // Create started at cell
            const startedCell = document.createElement('td');
            startedCell.textContent = file.startedAt ? formatDateTime(new Date(file.startedAt)) : '-';

            // Create completed at cell
            const completedCell = document.createElement('td');
            completedCell.textContent = file.completedAt ? formatDateTime(new Date(file.completedAt)) : '-';

            // Add cells to row
            row.appendChild(fileCell);
            row.appendChild(statusCell);
            row.appendChild(startedCell);
            row.appendChild(completedCell);

            // Add row to table
            uploadHistoryTable.appendChild(row);
          });

          // Update show more button visibility
          if (totalFiles > displayLimit) {
            showMoreBtn.classList.remove('d-none');
            historyCount.textContent = `Showing ${filesToShow.length} of ${totalFiles} files`;
          } else {
            showMoreBtn.classList.add('d-none');
            historyCount.textContent = `Showing ${filesToShow.length} file${filesToShow.length !== 1 ? 's' : ''}`;
          }
        }

        function formatDateTime(date) {
          return date.toLocaleString();
        }
      });
    </script>
  </body>
  </html>
  EOL
  fi

  if [ ! -f "translation-viewer/views/item.ejs" ]; then
    echo -e "${YELLOW}Creating item.ejs view...${NC}"
    cat > translation-viewer/views/item.ejs << 'EOL'
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><%= itemSlug %> - Translation Viewer</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism.min.css">
    <style>
      .language-badge {
        font-size: 0.8rem;
        border-radius: 30px;
        padding: 5px 15px;
      }

      .translation-card {
        margin-bottom: 20px;
      }

      .json-preview {
        max-height: 500px;
        overflow-y: auto;
        border-radius: 5px;
      }

      .nav-link {
        padding: 10px 15px;
        border-radius: 4px;
        margin-right: 5px;
      }

      .nav-link.active {
        background-color: #0d6efd;
        color: white !important;
      }

      #previewTab {
        background-color: #e0f7fa;
        margin-top: 20px;
        padding: 20px;
        border-radius: 5px;
      }

      #fieldSelector {
        margin-bottom: 15px;
      }
    </style>
  </head>
  <body>
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
      <div class="container">
        <a class="navbar-brand" href="/">Translation Viewer</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarNav">
          <ul class="navbar-nav">
            <li class="nav-item">
              <a class="nav-link" href="/">Home</a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="/upload-status">Upload Status</a>
            </li>
          </ul>
        </div>
      </div>
    </nav>

    <div class="container mt-4">
      <nav aria-label="breadcrumb">
        <ol class="breadcrumb">
          <li class="breadcrumb-item"><a href="/">Home</a></li>
          <li class="breadcrumb-item"><a href="/content/<%= contentType %>"><%= contentType %></a></li>
          <li class="breadcrumb-item active" aria-current="page"><%= itemSlug %></li>
        </ol>
      </nav>

      <h1 class="mb-4"><%= itemSlug %></h1>
      <p class="lead">Content Type: <span class="badge bg-primary"><%= contentType %></span></p>

      <div id="languageBadges" class="mb-4"></div>

      <ul class="nav nav-tabs" id="translationTabs">
        <li class="nav-item">
          <a class="nav-link active" data-bs-toggle="tab" href="#jsonTab">JSON View</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" data-bs-toggle="tab" href="#diffTab">Compare View</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" data-bs-toggle="tab" href="#previewTab">Preview</a>
        </li>
      </ul>

      <div class="tab-content mt-3">
        <div class="tab-pane fade show active" id="jsonTab">
          <div id="translationsContainer" class="row">
            <div class="col-12 text-center">
              <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="diffTab">
          <div class="row mb-3">
            <div class="col-md-6">
              <label for="sourceLanguage" class="form-label">Source Language</label>
              <select class="form-select" id="sourceLanguage"></select>
            </div>
            <div class="col-md-6">
              <label for="targetLanguage" class="form-label">Target Language</label>
              <select class="form-select" id="targetLanguage"></select>
            </div>
          </div>

          <div class="row">
            <div class="col-12">
              <div class="form-group mb-3">
                <label for="fieldSelector" class="form-label">Select Field</label>
                <select class="form-select" id="fieldSelector">
                  <option value="">Loading fields...</option>
                </select>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-md-6">
              <div class="card">
                <div class="card-header">
                  <span id="sourceLanguageLabel">Source Language</span>
                </div>
                <div class="card-body">
                  <div id="sourceContent" class="p-3 bg-light">Select a field to compare</div>
                </div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="card">
                <div class="card-header">
                  <span id="targetLanguageLabel">Target Language</span>
                </div>
                <div class="card-body">
                  <div id="targetContent" class="p-3 bg-light">Select a field to compare</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="tab-pane fade" id="previewTab">
          <div class="row mb-3">
            <div class="col-md-6">
              <label for="previewLanguage" class="form-label">Select Language</label>
              <select class="form-select" id="previewLanguage"></select>
            </div>
          </div>

          <div class="card">
            <div class="card-header bg-primary text-white">
              <h5 class="card-title mb-0">Content Preview</h5>
            </div>
            <div class="card-body">
              <div id="contentPreview">
                <p class="text-center">Select a language to preview content</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js"></script>
    <script>
      let translationsData = {};
      let availableLanguages = [];
      let availableFields = [];

      document.addEventListener('DOMContentLoaded', function() {
        const contentType = '<%= contentType %>';
        const itemSlug = '<%= itemSlug %>';

        // Fetch translations for this item
        fetch(`/api/translations/${contentType}/${itemSlug}`)
          .then(response => response.json())
          .then(data => {
            if (!data.translations || Object.keys(data.translations).length === 0) {
              document.getElementById('translationsContainer').innerHTML =
                '<div class="col-12"><p class="text-center">No translations found</p></div>';
              return;
            }

            translationsData = data.translations;
            availableLanguages = Object.keys(translationsData);

            // Populate language badges
            const languageBadgesContainer = document.getElementById('languageBadges');
            languageBadgesContainer.innerHTML = '';
            availableLanguages.forEach(lang => {
              const badge = document.createElement('span');
              badge.className = 'badge language-badge bg-secondary me-2';
              badge.textContent = lang;
              languageBadgesContainer.appendChild(badge);
            });

            // Populate language dropdowns
            populateLanguageDropdowns();

            // Extract fields for the field selector
            const firstLang = availableLanguages[0];
            if (firstLang && translationsData[firstLang] && translationsData[firstLang].translatedAttributes) {
              extractFieldPaths(translationsData[firstLang].translatedAttributes);
              populateFieldSelector();
            }

            // Render JSON view
            renderTranslations();

            // Set up event listeners
            setupEventListeners();
          })
          .catch(error => {
            console.error(`Error fetching translations for ${contentType}/${itemSlug}:`, error);
            document.getElementById('translationsContainer').innerHTML =
              '<div class="col-12"><p class="text-center text-danger">Error loading translations</p></div>';
          });
      });

      function renderTranslations() {
        const container = document.getElementById('translationsContainer');
        container.innerHTML = '';

        availableLanguages.forEach(lang => {
          const col = document.createElement('div');
          col.className = 'col-lg-6 translation-card';

          const card = document.createElement('div');
          card.className = 'card h-100';

          const cardHeader = document.createElement('div');
          cardHeader.className = 'card-header';
          cardHeader.innerHTML = `<h5 class="card-title mb-0">
            <span class="badge language-badge bg-primary me-2">${lang}</span> Translation
          </h5>`;

          const cardBody = document.createElement('div');
          cardBody.className = 'card-body';

          const preElement = document.createElement('pre');
          preElement.className = 'json-preview';

          const codeElement = document.createElement('code');
          codeElement.className = 'language-json';
          codeElement.textContent = JSON.stringify(translationsData[lang], null, 2);

          preElement.appendChild(codeElement);
          cardBody.appendChild(preElement);
          card.appendChild(cardHeader);
          card.appendChild(cardBody);
          col.appendChild(card);
          container.appendChild(col);
        });

        // Highlight the code
        Prism.highlightAll();
      }

      function populateLanguageDropdowns() {
        const sourceLanguageSelect = document.getElementById('sourceLanguage');
        const targetLanguageSelect = document.getElementById('targetLanguage');
        const previewLanguageSelect = document.getElementById('previewLanguage');

        sourceLanguageSelect.innerHTML = '';
        targetLanguageSelect.innerHTML = '';
        previewLanguageSelect.innerHTML = '';

        availableLanguages.forEach((lang, index) => {
          const sourceOption = document.createElement('option');
          sourceOption.value = lang;
          sourceOption.textContent = lang;
          sourceLanguageSelect.appendChild(sourceOption);

          const targetOption = document.createElement('option');
          targetOption.value = lang;
          targetOption.textContent = lang;
          // Select the second language as the default target if available
          if (index === 1) {
            targetOption.selected = true;
          }
          targetLanguageSelect.appendChild(targetOption);

          const previewOption = document.createElement('option');
          previewOption.value = lang;
          previewOption.textContent = lang;
          previewLanguageSelect.appendChild(previewOption);
        });

        // Default to the first language for source and preview (if available)
        if (availableLanguages.length > 0) {
          sourceLanguageSelect.value = availableLanguages[0];
          previewLanguageSelect.value = availableLanguages[0];
        }

        // Update labels
        updateLanguageLabels();
      }

      function updateLanguageLabels() {
        const sourceLanguage = document.getElementById('sourceLanguage').value;
        const targetLanguage = document.getElementById('targetLanguage').value;

        document.getElementById('sourceLanguageLabel').textContent = sourceLanguage;
        document.getElementById('targetLanguageLabel').textContent = targetLanguage;
      }

      function extractFieldPaths(obj, prefix = '', result = []) {
        if (!obj || typeof obj !== 'object') return result;

        for (const key in obj) {
          const value = obj[key];
          const path = prefix ? `${prefix}.${key}` : key;

          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // For nested objects, recursively extract paths
            extractFieldPaths(value, path, result);
          } else if (Array.isArray(value)) {
            // For arrays, add the array itself as a field
            result.push({
              path: path,
              type: 'array',
              label: path
            });

            // For simple arrays of strings/numbers, don't process further
            if (value.length > 0 && typeof value[0] !== 'object') {
              continue;
            }

            // For arrays of objects, process each item (just the first one as an example)
            if (value.length > 0 && typeof value[0] === 'object') {
              for (let i = 0; i < Math.min(value.length, 3); i++) {
                extractFieldPaths(value[i], `${path}[${i}]`, result);
              }
            }
          } else if (typeof value === 'string') {
            // For string values, add as a simple field
            result.push({
              path: path,
              type: 'string',
              label: path,
              value: value
            });
          }
        }

        availableFields = result;
        return result;
      }

      function populateFieldSelector() {
        const fieldSelector = document.getElementById('fieldSelector');
        fieldSelector.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Select a field --';
              fieldSelector.appendChild(defaultOption);

              // Group fields by top-level category
              const groupedFields = {};

              availableFields.forEach(field => {
                const topLevel = field.path.split('.')[0];

                if (!groupedFields[topLevel]) {
                  groupedFields[topLevel] = [];
                }

                groupedFields[topLevel].push(field);
              });

              // Create option groups
              Object.keys(groupedFields).sort().forEach(group => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = group;

                groupedFields[group].sort((a, b) => a.path.localeCompare(b.path)).forEach(field => {
                  if (field.type === 'string') {
                    const option = document.createElement('option');
                    option.value = field.path;
                    option.textContent = field.path;
                    optgroup.appendChild(option);
                  }
                });

                fieldSelector.appendChild(optgroup);
              });
            }

            function getFieldValue(obj, path) {
              const parts = path.split('.');
              let value = obj;

              for (let i = 0; i < parts.length; i++) {
                let part = parts[i];

                // Handle array indexing
                if (part.includes('[') && part.includes(']')) {
                  const arrayName = part.substring(0, part.indexOf('['));
                  const indexStr = part.substring(part.indexOf('[') + 1, part.indexOf(']'));
                  const index = parseInt(indexStr, 10);

                  value = value[arrayName];
                  if (!Array.isArray(value) || index >= value.length) {
                    return undefined;
                  }

                  value = value[index];
                } else {
                  value = value[part];
                  if (value === undefined) {
                    return undefined;
                  }
                }
              }

              return value;
            }

            function displayComparedContent() {
              const fieldPath = document.getElementById('fieldSelector').value;
              if (!fieldPath) return;

              const sourceLanguage = document.getElementById('sourceLanguage').value;
              const targetLanguage = document.getElementById('targetLanguage').value;

              const sourceContent = document.getElementById('sourceContent');
              const targetContent = document.getElementById('targetContent');

              // Get the source and target data
              const sourceData = translationsData[sourceLanguage]?.translatedAttributes;
              const targetData = translationsData[targetLanguage]?.translatedAttributes;

              if (!sourceData || !targetData) {
                sourceContent.innerHTML = 'Source data not available';
                targetContent.innerHTML = 'Target data not available';
                return;
              }

              // Extract the field value from each language
              const sourceValue = getFieldValue(sourceData, fieldPath);
              const targetValue = getFieldValue(targetData, fieldPath);

              // Display the values
              if (typeof sourceValue === 'string') {
                sourceContent.innerHTML = sourceValue || '<em class="text-muted">Empty</em>';
              } else {
                sourceContent.innerHTML = `<pre><code>${JSON.stringify(sourceValue, null, 2)}</code></pre>`;
              }

              if (typeof targetValue === 'string') {
                targetContent.innerHTML = targetValue || '<em class="text-muted">Empty</em>';
              } else {
                targetContent.innerHTML = `<pre><code>${JSON.stringify(targetValue, null, 2)}</code></pre>`;
              }
            }

            function displayPreview() {
              const previewLanguage = document.getElementById('previewLanguage').value;
              const contentPreview = document.getElementById('contentPreview');

              // Get the data for the selected language
              const data = translationsData[previewLanguage]?.translatedAttributes;

              if (!data) {
                contentPreview.innerHTML = '<p class="text-center">Preview data not available</p>';
                return;
              }

              // Create a preview of the content
              let html = '';

              // Title and short description
              if (data.title) {
                html += `<h1>${data.title}</h1>`;
              }

              if (data.shortDescription) {
                html += `<div class="lead mb-4">${data.shortDescription}</div>`;
              }

              // Description (if HTML)
              if (data.description) {
                html += `<div class="mb-4">${data.description}</div>`;
              }

              // Table of content or FAQ if available
              if (data.tableOfContent && Array.isArray(data.tableOfContent)) {
                html += `<div class="card mb-4">
                  <div class="card-header">
                    <h3>Table of Contents</h3>
                  </div>
                  <div class="card-body">
                    <ol>`;

                data.tableOfContent.forEach(item => {
                  html += `<li>
                    <h4>${item.title || ''}</h4>
                    ${item.description || ''}
                  </li>`;
                });

                html += `</ol>
                  </div>
                </div>`;
              }

              if (data.faqList && Array.isArray(data.faqList)) {
                html += `<div class="card mb-4">
                  <div class="card-header">
                    <h3>${data.faqSectionHeading || 'FAQ'}</h3>
                  </div>
                  <div class="card-body">
                    <div class="accordion" id="faqAccordion">`;

                data.faqList.forEach((item, index) => {
                  html += `<div class="accordion-item">
                    <h2 class="accordion-header">
                      <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq${index}">
                        ${item.title || ''}
                      </button>
                    </h2>
                    <div id="faq${index}" class="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                      <div class="accordion-body">
                        ${item.description || ''}
                      </div>
                    </div>
                  </div>`;
                });

                html += `</div>
                  </div>
                </div>`;
              }

              contentPreview.innerHTML = html || '<p class="text-center">No preview content available</p>';
            }

            function setupEventListeners() {
              // Field selector change
              const fieldSelector = document.getElementById('fieldSelector');
              if (fieldSelector) {
                fieldSelector.addEventListener('change', displayComparedContent);
              }

              // Source language change
              const sourceLanguage = document.getElementById('sourceLanguage');
              if (sourceLanguage) {
                sourceLanguage.addEventListener('change', () => {
                  updateLanguageLabels();
                  displayComparedContent();
                });
              }

              // Target language change
              const targetLanguage = document.getElementById('targetLanguage');
              if (targetLanguage) {
                targetLanguage.addEventListener('change', () => {
                  updateLanguageLabels();
                  displayComparedContent();
                });
              }

              // Preview language change
              const previewLanguage = document.getElementById('previewLanguage');
              if (previewLanguage) {
                previewLanguage.addEventListener('change', displayPreview);
              }

              // Tab change events
              const tabs = document.querySelectorAll('a[data-bs-toggle="tab"]');
              tabs.forEach(tab => {
                tab.addEventListener('shown.bs.tab', (event) => {
                  const target = event.target.getAttribute('href');

                  if (target === '#diffTab') {
                    displayComparedContent();
                  } else if (target === '#previewTab') {
                    displayPreview();
                  }
                });
              });
            }
          </script>
        </body>
        </html>
        EOL
        fi

        # Create empty uploadStatusTracker.js if it doesn't exist
        if [ ! -f "uploadStatusTracker.js" ]; then
          echo -e "${YELLOW}Creating uploadStatusTracker.js...${NC}"
          cat > uploadStatusTracker.js << 'EOL'
        /**
         * Upload Status Tracker Module
         *
         * This module tracks the status of file uploads to Strapi
         * and provides an API for the viewer to check upload status.
         */

        const fs = require('fs');
        const path = require('path');

        class UploadStatusTracker {
          constructor(statusFilePath) {
            this.statusFilePath = statusFilePath || path.join(process.cwd(), 'upload-status.json');
            this.uploadStatus = this.loadStatus();
            console.log(`Upload Status Tracker initialized with file: ${this.statusFilePath}`);
          }

          /**
           * Load the current status from the status file
           */
          loadStatus() {
            try {
              if (fs.existsSync(this.statusFilePath)) {
                const data = fs.readFileSync(this.statusFilePath, 'utf8');
                return JSON.parse(data);
              }
            } catch (error) {
              console.error('Error loading upload status:', error);
            }

            // Default empty status
            return {
              lastUpdated: new Date().toISOString(),
              currentlyUploading: null,
              files: {}
            };
          }

          /**
           * Save the current status to the status file
           */
          saveStatus() {
            try {
              this.uploadStatus.lastUpdated = new Date().toISOString();
              fs.writeFileSync(this.statusFilePath, JSON.stringify(this.uploadStatus, null, 2), 'utf8');
            } catch (error) {
              console.error('Error saving upload status:', error);
            }
          }

          /**
           * Mark a file as upload started
           * @param {string} filePath - Path to the file being uploaded
           */
          startUpload(filePath) {
            const relativePath = this.getRelativePath(filePath);
            this.uploadStatus.currentlyUploading = relativePath;
            this.uploadStatus.files[relativePath] = {
              status: 'uploading',
              startedAt: new Date().toISOString(),
              completedAt: null,
              error: null
            };
            this.saveStatus();
          }

          /**
           * Mark a file as upload completed
           * @param {string} filePath - Path to the file that was uploaded
           * @param {boolean} success - Whether the upload was successful
           * @param {string} error - Error message if the upload failed
           */
          completeUpload(filePath, success = true, error = null) {
            const relativePath = this.getRelativePath(filePath);

            if (this.uploadStatus.currentlyUploading === relativePath) {
              this.uploadStatus.currentlyUploading = null;
            }

            if (!this.uploadStatus.files[relativePath]) {
              this.uploadStatus.files[relativePath] = {
                startedAt: new Date().toISOString()
              };
            }

            this.uploadStatus.files[relativePath].status = success ? 'completed' : 'failed';
            this.uploadStatus.files[relativePath].completedAt = new Date().toISOString();

            if (error) {
              this.uploadStatus.files[relativePath].error = error;
            }

            this.saveStatus();
          }

          /**
           * Get the status of all uploads
           */
          getStatus() {
            return this.uploadStatus;
          }

          /**
           * Get the status of a specific file
           * @param {string} filePath - Path to the file
           */
          getFileStatus(filePath) {
            const relativePath = this.getRelativePath(filePath);
            return this.uploadStatus.files[relativePath] || { status: 'pending' };
          }

          /**
           * Get the currently uploading file
           */
          getCurrentUpload() {
            return this.uploadStatus.currentlyUploading;
          }

          /**
           * Get statistics about uploads
           */
          getStats() {
            const files = Object.values(this.uploadStatus.files);
            return {
              total: files.length,
              completed: files.filter(f => f.status === 'completed').length,
              failed: files.filter(f => f.status === 'failed').length,
              uploading: files.filter(f => f.status === 'uploading').length,
              pending: files.filter(f => !f.status || f.status === 'pending').length
            };
          }

          /**
           * Convert an absolute path to a relative path
           * @param {string} filePath - Absolute path to the file
           */
          getRelativePath(filePath) {
            // Remove any common path prefix to get a consistent identifier
            return path.relative(process.cwd(), filePath);
          }

          /**
           * Scan the translations directory to identify all potential files
           * @param {string} translationsDir - Path to the translations directory
           */
          scanTranslationsDirectory(translationsDir) {
            try {
              const pendingFiles = [];

              // Function to walk the directory tree
              const walkDir = (dir) => {
                if (!fs.existsSync(dir)) return;

                const files = fs.readdirSync(dir);

                files.forEach(file => {
                  const filePath = path.join(dir, file);
                  const stat = fs.statSync(filePath);

                  if (stat.isDirectory()) {
                    walkDir(filePath);
                  } else if (file.endsWith('.json')) {
                    const relativePath = this.getRelativePath(filePath);

                    // If this file doesn't have a status yet, mark it as pending
                    if (!this.uploadStatus.files[relativePath]) {
                      this.uploadStatus.files[relativePath] = {
                        status: 'pending',
                        startedAt: null,
                        completedAt: null,
                        error: null
                      };
                      pendingFiles.push(relativePath);
                    }
                  }
                });
              };

              walkDir(translationsDir);

              if (pendingFiles.length > 0) {
                this.saveStatus();
                console.log(`Added ${pendingFiles.length} new files to the upload status tracker`);
              }

              return pendingFiles;
            } catch (error) {
              console.error('Error scanning translations directory:', error);
              return [];
            }
          }
        }

        module.exports = UploadStatusTracker;
        EOL
        fi

        # Create empty uploadService.js if it doesn't exist
        if [ ! -f "uploadService.js" ]; then
          echo -e "${YELLOW}Creating uploadService.js...${NC}"
          cat > uploadService.js << 'EOL'
        /**
         * Modified Upload Service
         *
         * This file is a wrapper around the original uploadTranslations.js
         * that adds tracking of upload status.
         */

        const fs = require('fs');
        const path = require('path');
        const { promisify } = require('util');
        const UploadStatusTracker = require('./uploadStatusTracker');

        // Import the original upload module - make sure path is correct
        let originalUploader = null;
        try {
          originalUploader = require('./uploadTranslations');
          console.log("Successfully loaded uploadTranslations.js");
        } catch (err) {
          console.error("Error loading uploadTranslations.js:", err);

          // Create a mock uploadTranslations if the real one doesn't exist
          originalUploader = {
            pushSingleTranslation: async function(translationData) {
              console.log(`[MOCK] Would upload ${translationData.originalSlug} to ${translationData.targetLocale}`);
              return { success: true, message: "Mock upload successful", id: "mock-id" };
            },
            uploadMain: async function() {
              console.log("[MOCK] Running mock uploadMain function");
            }
          };
        }

        // Create a status tracker
        const statusTracker = new UploadStatusTracker();

        // Override the pushSingleTranslation function to track status
        const originalPushSingleTranslation = originalUploader.pushSingleTranslation;

        originalUploader.pushSingleTranslation = async function(translationData) {
          const { originalSlug, contentType, targetLocale } = translationData;
          const filePath = path.join(process.env.OUTPUT_DIR || './translations', contentType, originalSlug, `${originalSlug}_${targetLocale}.json`);

          try {
            // Mark upload as started
            statusTracker.startUpload(filePath);
            console.log(`Starting upload of ${filePath}`);

            // Call the original upload function
            const result = await originalPushSingleTranslation(translationData);

            // Mark upload as completed with the result
            if (result.success) {
              console.log(`Completed upload of ${filePath} successfully`);
              statusTracker.completeUpload(filePath, true);
            } else {
              console.log(`Failed to upload ${filePath}: ${result.message}`);
              statusTracker.completeUpload(filePath, false, result.message);
            }

            return result;
          } catch (error) {
            // Mark upload as failed if an exception occurred
            console.error(`Error uploading ${filePath}:`, error);
            statusTracker.completeUpload(filePath, false, error.message);
            throw error;
          }
        };

        // Add a periodic scan of the translations directory
        const scanTranslationsDirectory = () => {
          const translationsDir = process.env.OUTPUT_DIR || './translations';
          const newFiles = statusTracker.scanTranslationsDirectory(translationsDir);

          if (newFiles.length > 0) {
            console.log(`Found ${newFiles.length} new files to track for uploading`);
          }

          // Schedule next scan
          setTimeout(scanTranslationsDirectory, 60000); // Scan every minute
        };

        // Start scanning
        scanTranslationsDirectory();

        // Add a new method to get the status
        originalUploader.getUploadStatus = () => {
          return statusTracker.getStatus();
        };

        originalUploader.getUploadStats = () => {
          return statusTracker.getStats();
        };

        // Create an empty upload-status.json file if it doesn't exist
        const uploadStatusPath = path.join(process.cwd(), 'upload-status.json');
        if (!fs.existsSync(uploadStatusPath)) {
          const emptyStatus = {
            lastUpdated: new Date().toISOString(),
            currentlyUploading: null,
            files: {}
          };
          try {
            fs.writeFileSync(uploadStatusPath, JSON.stringify(emptyStatus, null, 2), 'utf8');
            console.log(`Created empty upload-status.json file at ${uploadStatusPath}`);
          } catch (err) {
            console.error('Failed to create upload-status.json file:', err);
          }
        }

        // If uploadTranslations has a main function, call it
        if (typeof originalUploader.uploadMain === 'function') {
          // Replace the original main function with one that includes tracking
          const originalUploadMain = originalUploader.uploadMain;
          originalUploader.uploadMain = async function() {
            try {
              console.log("Starting upload process with status tracking...");
              await originalUploadMain();
              console.log("Upload process completed successfully.");
            } catch (error) {
              console.error("Error in upload process:", error);
            }
          };

          // If this file is run directly, call uploadMain
          if (require.main === module) {
            originalUploader.uploadMain()
              .then(() => console.log("\nUpload script finished with status tracking."))
              .catch((err) => {
                console.error("\n--- UPLOAD SCRIPT FAILED ---");
                console.error(err);
                process.exit(1);
              });
          }
        }

        module.exports = originalUploader;
        EOL
        fi

# Create an empty upload-status.json file if it doesn't exist
if [ ! -f "upload-status.json" ]; then
    echo -e "${YELLOW}Creating empty upload-status.json file...${NC}"
    cat > upload-status.json << 'EOL'
{
    "lastUpdated": "2023-01-01T00:00:00.000Z",
    "currentlyUploading": null,
    "files": {}
}
EOL
fi

echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  Translation Viewer setup complete!             ${NC}"
echo -e "${GREEN}=================================================${NC}"
echo -e "\n${YELLOW}You can now run the translation viewer with:${NC}"
echo -e "  node translation-viewer/app.js"
