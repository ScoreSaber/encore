#define _POSIX_C_SOURCE 200809L

#include <dirent.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

enum scan_result {
   SCAN_RETRY = -1,
   SCAN_NOT_FOUND = 0,
   SCAN_FOUND = 1
};

static enum scan_result scan_processes(const char *process_name) {
   DIR *processes = opendir("/proc");
   if (processes == NULL) return SCAN_RETRY;

   struct dirent *entry;
   while ((entry = readdir(processes)) != NULL) {
      if (*entry->d_name == '\0' || strspn(entry->d_name, "0123456789") != strlen(entry->d_name)) continue;

      char comm_path[64];
      int path_length = snprintf(comm_path, sizeof(comm_path), "/proc/%s/comm", entry->d_name);
      if (path_length < 0 || (size_t)path_length >= sizeof(comm_path)) continue;

      FILE *comm = fopen(comm_path, "r");
      if (comm == NULL) continue;

      char name[256];
      char *read = fgets(name, sizeof(name), comm);
      fclose(comm);
      if (read == NULL) continue;

      name[strcspn(name, "\r\n")] = '\0';
      if (strcasecmp(name, process_name) != 0) continue;

      closedir(processes);
      return SCAN_FOUND;
   }

   closedir(processes);
   return SCAN_NOT_FOUND;
}

int main(int argument_count, char **arguments) {
   int flatpak = argument_count == 5 && strcmp(arguments[1], "--flatpak") == 0;
   int parent_mode = argument_count == 5 && strcmp(arguments[1], "--parent") == 0;
   if (!flatpak && !parent_mode) return 2;

   char *end = NULL;
   long parsed_process_id = parent_mode ? strtol(arguments[2], &end, 10) : 0;
   if (parent_mode && (end == arguments[2] || *end != '\0' || parsed_process_id <= 0)) return 2;

   pid_t parent_process_id = (pid_t)parsed_process_id;
   const char *flatpak_id = flatpak ? arguments[2] : NULL;
   const char *game_process_name = arguments[3];
   const char *relaunch_executable = arguments[4];
   int found = 0;

   for (int attempt = 0; attempt < 300; attempt++) {
      struct timespec remaining = {1, 0};
      while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) {
      }

      if (parent_mode && kill(parent_process_id, 0) != 0 && errno != EPERM) break;
      if (scan_processes(game_process_name) == SCAN_FOUND) {
         found = 1;
         break;
      }
   }

   if (!found) return 0;

   if (flatpak) {
      pid_t child = fork();
      if (child == -1) return 3;
      if (child == 0) {
         execlp(relaunch_executable, relaunch_executable, "kill", flatpak_id, (char *)NULL);
         _exit(127);
      }

      int status = 0;
      while (waitpid(child, &status, 0) == -1) {
         if (errno != EINTR) return 3;
      }
      if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return 3;
   } else {
      int shutdown_signals[] = {SIGTERM, SIGKILL};
      int closed = 0;

      for (int signal_index = 0; signal_index < 2 && !closed; signal_index++) {
         if (kill(parent_process_id, shutdown_signals[signal_index]) != 0 && errno != ESRCH) return 3;

         for (int attempt = 0; attempt < 50; attempt++) {
            if (kill(parent_process_id, 0) != 0 && errno != EPERM) {
               closed = 1;
               break;
            }

            struct timespec remaining = {0, 100000000};
            while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) {
            }
         }
      }

      if (!closed) closed = kill(parent_process_id, 0) != 0 && errno != EPERM;
      if (!closed) return 3;
   }

   int absent_scans = 0;
   while (absent_scans < 2) {
      struct timespec remaining = {1, 0};
      while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) {
      }

      enum scan_result result = scan_processes(game_process_name);
      if (result == SCAN_FOUND) absent_scans = 0;
      else if (result == SCAN_NOT_FOUND) absent_scans++;
   }

   if (flatpak) execlp(relaunch_executable, relaunch_executable, "run", flatpak_id, (char *)NULL);
   else execl(relaunch_executable, relaunch_executable, (char *)NULL);
   return 4;
}
